// src/pages/CookiePolicy.jsx
import LegalPageLayout from "../components/LegalPageLayout";

const sections = [
  {
    id: "what-are-cookies",
    heading: "1. What Are Cookies",
    body: [
      { type: "p", text: "Cookies are small text files a website stores in your browser. \"Similar technologies\" covers things like local storage, which work the same way for our purposes — remembering something about your visit. We use both." },
    ],
  },
  {
    id: "how-we-use",
    heading: "2. How We Use Cookies",
    body: [
      { type: "p", text: "Essential — used by Firebase Authentication to keep you signed in between visits and to keep your account secure. The Service won't work properly without these." },
      { type: "p", text: "Analytics — Google Analytics and Vercel Analytics use cookies or similar identifiers to help us understand aggregate traffic and feature usage (which pages get visited, roughly how many people use a feature) so we can improve the Service. This data is used in aggregate, not to identify you individually." },
      { type: "p", text: "Preferences — some features may store simple settings in your browser's local storage, like a collapsed panel or a remembered tab, purely for your own convenience." },
    ],
  },
  {
    id: "third-party-cookies",
    heading: "3. Third-Party Cookies",
    body: [
      { type: "p", text: "Some cookies are set by our service providers, not by us directly — for example, Google (Firebase Authentication, Google Analytics) and Vercel (Vercel Analytics). Their use of cookies is governed by their own privacy policies." },
    ],
  },
  {
    id: "your-choices",
    heading: "4. Your Choices",
    body: [
      { type: "p", text: "Most browsers let you block or delete cookies through their settings — keep in mind that blocking essential cookies may prevent you from staying signed in. You can also opt out of Google Analytics specifically using Google's browser add-on." },
    ],
  },
  {
    id: "changes",
    heading: "5. Changes to This Policy",
    body: [
      { type: "p", text: "We may update this Cookie Policy from time to time. If we make material changes, we'll update the \"Last updated\" date above." },
    ],
  },
  {
    id: "contact",
    heading: "6. Contact Us",
    body: [
      { type: "p", text: "Questions about this Cookie Policy? Reach us at privacy@we-draft.com." },
    ],
  },
];

export default function CookiePolicy() {
  return (
    <LegalPageLayout
      title="Cookie Policy"
      description="How We-Draft.com uses cookies and similar technologies, and your choices."
      lastUpdated="September 8, 2026"
      intro="This Cookie Policy explains the cookies and similar technologies We-Draft.com uses and how to control them — it works alongside our Privacy Policy."
      sections={sections}
    />
  );
}
