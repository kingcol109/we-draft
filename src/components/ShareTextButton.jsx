// src/components/ShareTextButton.jsx
//
// Share as a message: the player page's Share (in the hero toolbar, where
// Like was) and Share Evaluation (PlayerProfile.js) — the text is a few
// lines about the player, ending with the page's link.
// Without a graphic: phones get the system share sheet (Messages,
// WhatsApp…) with that text; elsewhere a dialog showing the caller's card of
// it (preview — the text itself isn't shown), then Copy, Text and Email.
// With a graphic (Share Evaluation's, components/PlayerEvalGraphic.jsx):
// every device gets the dialog, the graphic built into an image as it opens
// (an Instagram post, 1080 × 1350) — Save Image, Share Image (a phone's
// share sheet, with the picture) — and the same Copy, Text and Email for
// the message under it.
// The button's look is the caller's (style / className); this only adds
// the behavior.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { renderShareImage } from "../utils/exportImages";
import ShareSheet, { ShareImagePreview, shareActions } from "./ShareSheet";

// A phone or tablet: its share sheet is the way to send a message.
const touchShare = () => typeof navigator !== "undefined" && !!navigator.share
  && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

// The image as a file, for a share sheet that takes one.
async function imageFile(url, name) {
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type: "image/png" });
}

// text: the whole message, link last; preview: what the dialog shows of it;
// subject: the email's subject and the dialog's heading (the dialog is
// ShareSheet.jsx, the site's one share dialog). graphic: { render: (ref) => the graphic, fileName }.
// openSignal / promptTitle: open it without a click — a number that goes
// up each time (the player page's "share it?" after Save Evaluation,
// utils/sharePrompt.js) — headed promptTitle instead of subject.
export default function ShareTextButton({ text, preview, subject, style, className, title, graphic = null, openSignal = 0, promptTitle, children }) {
  const [open, setOpen] = useState(false);
  const [prompted, setPrompted] = useState(false);
  const graphicRef = useRef(null);
  const building = useRef(false);
  const [image, setImage] = useState(null); // data URL
  const [failed, setFailed] = useState(false);
  // The graphic's contents change with the report: build again once it's
  // closed and opened after an edit.
  const builtFor = useRef("");

  const build = async () => {
    if (building.current || !graphicRef.current) return;
    if (image && builtFor.current === text) return;
    building.current = true;
    setFailed(false);
    setImage(null);
    try {
      const url = await renderShareImage(graphicRef.current, { pixelRatio: 1.5, backgroundColor: "#06162c" }); // 720 × 900 → 1080 × 1350
      builtFor.current = text;
      setImage(url);
    } catch (e) {
      setFailed(true);
    } finally {
      building.current = false;
    }
  };

  useEffect(() => {
    if (!openSignal) return;
    setPrompted(true);
    setOpen(true);
    if (graphic) setTimeout(build, 0);
  }, [openSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); setPrompted(false); };

  const onClick = async () => {
    if (graphic) { setOpen(true); build(); return; }
    if (touchShare()) {
      try { await navigator.share({ text }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    setOpen(true);
  };
  const saveImage = () => {
    if (!image) return;
    const a = document.createElement("a");
    a.download = graphic.fileName;
    a.href = image;
    a.click();
  };
  // The share sheet with the picture (and the message, where the app takes
  // both); without file sharing, Save Image is the way.
  const [canShareFile, setCanShareFile] = useState(false);
  useEffect(() => {
    if (!image || !graphic || !navigator.canShare) return undefined;
    let live = true;
    imageFile(image, graphic.fileName)
      .then((f) => { if (live) setCanShareFile(!!navigator.canShare({ files: [f] })); })
      .catch(() => {});
    return () => { live = false; };
  }, [image]); // eslint-disable-line react-hooks/exhaustive-deps
  const shareImage = async () => {
    if (!image) return;
    try {
      const f = await imageFile(image, graphic.fileName);
      await navigator.share({ files: [f], text });
    } catch (e) { /* cancelled, or the app refused it */ }
  };

  return (
    <>
      <button onClick={onClick} title={title} className={className} style={style}>{children}</button>
      {/* The graphic, drawn off screen at the page root so it inherits
          nothing from wherever the button sits. */}
      {graphic && createPortal(<div style={{ position: "absolute", left: -9999, top: 0 }} aria-hidden="true">{graphic.render(graphicRef)}</div>, document.body)}
      <ShareSheet open={open} onClose={close} title={prompted && promptTitle ? promptTitle : subject} subtitle={prompted && promptTitle ? "Post it, text it, or save the graphic." : undefined}
        preview={graphic ? <ShareImagePreview src={image} alt="Your share graphic" failed={failed} /> : preview}
        primary={graphic ? [
          { label: "Save image", icon: "download", onClick: saveImage, disabled: !image },
          ...(canShareFile ? [{ label: "Share image", icon: "share", onClick: shareImage, disabled: !image, alt: true }] : []),
        ] : []}
        actions={[shareActions.copy(text), shareActions.text(text), shareActions.email(subject, text)]} />
    </>
  );
}
