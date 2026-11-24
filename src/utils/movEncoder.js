// src/utils/movEncoder.js
//
// Transparent video for Premiere, made in the browser: PNG frames → a
// QuickTime .mov in ProRes 4444 with alpha (ap4h, yuva444p10le) — the
// format Premiere imports natively, transparency included.
//
// The encoder is ffmpeg.wasm (@ffmpeg/ffmpeg 0.12 + @ffmpeg/core 0.12),
// fetched from jsDelivr the first time a clip is made — never bundled, so
// the admin page costs nothing until then (~31 MB, cached by the browser
// after). Its worker can't load cross-origin, so the worker, core and wasm
// come in as blob URLs; the worker is a module worker, so the core is the
// ESM build. Single-threaded (no COOP/COEP headers needed): ~7 frames a
// second at 1080p.
const FF = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd";
const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";

const blobURL = async (url, type) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`couldn't fetch ${url.split("/").pop()} (${r.status})`);
  return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
};
const loadScript = (src) => new Promise((resolve, reject) => {
  if (window.FFmpegWASM) { resolve(); return; }
  const s = document.createElement("script");
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error("couldn't load the video encoder"));
  document.head.appendChild(s);
});

let ready = null;
// The one encoder, loaded once. onStatus("Loading the video encoder…").
export function loadEncoder(onStatus) {
  if (!ready) {
    ready = (async () => {
      onStatus?.("Loading the video encoder (first clip only)…");
      await loadScript(`${FF}/ffmpeg.js`);
      const ff = new window.FFmpegWASM.FFmpeg();
      await ff.load({
        classWorkerURL: await blobURL(`${FF}/814.ffmpeg.js`, "text/javascript"),
        coreURL: await blobURL(`${CORE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await blobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ff;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

// count frames, each made by frameAt(i) → a PNG Blob, at fps → a .mov Blob.
// onStatus gets progress lines. One clip at a time (the encoder's files are shared).
let queue = Promise.resolve();
export function encodeMov({ count, fps = 30, frameAt, onStatus }) {
  const job = queue.then(async () => {
    const ff = await loadEncoder(onStatus);
    const names = [];
    try {
      for (let i = 0; i < count; i += 1) {
        if (i % 5 === 0) onStatus?.(`Drawing frame ${i + 1} of ${count}…`);
        const png = await frameAt(i); // eslint-disable-line no-await-in-loop
        const name = `f${String(i).padStart(4, "0")}.png`;
        await ff.writeFile(name, new Uint8Array(await png.arrayBuffer())); // eslint-disable-line no-await-in-loop
        names.push(name);
      }
      onStatus?.("Encoding the clip…");
      const code = await ff.exec([
        "-framerate", String(fps), "-i", "f%04d.png",
        "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-vendor", "apl0",
        "-y", "out.mov",
      ]);
      if (code) throw new Error(`the encoder stopped (code ${code})`);
      const out = await ff.readFile("out.mov");
      return new Blob([out], { type: "video/quicktime" });
    } finally {
      await Promise.all([...names, "out.mov"].map((n) => ff.deleteFile(n).catch(() => {})));
    }
  });
  queue = job.catch(() => {});
  return job;
}
