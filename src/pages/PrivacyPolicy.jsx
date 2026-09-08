// src/pages/PrivacyPolicy.jsx
import LegalPageLayout from "../components/LegalPageLayout";

const sections = [
  {
    id: "overview",
    heading: "1. Overview",
    body: [
      { type: "p", text: "This Privacy Policy explains what information We-Draft.com (\"We-Draft,\" \"we,\" \"us\") collects, how we use it, and the choices you have. It applies to everyone who visits or creates an account on the Service." },
    ],
  },
  {
    id: "information-we-collect",
    heading: "2. Information We Collect",
    body: [
      { type: "p", text: "Account information — when you create an account, we (through Firebase Authentication) collect your email address and, if you sign up or sign in with Google, your Google account's name and profile photo. If you sign up with email/password instead, we never see or store your raw password — that's handled directly by our authentication provider." },
      { type: "p", text: "Content you provide — your username, scouting evaluations and grades, per-game notes, community board posts and comments, mock draft boards, We-Pick predictions, friend codes/connections, and anything else you submit through the Service." },
      { type: "p", text: "Usage & device information — pages you visit, features you use, general location (city/region level, inferred from IP address), device/browser type, and referring pages, collected automatically through analytics tools described below." },
      { type: "p", text: "Cookies and similar technologies — see our Cookie Policy for details." },
    ],
  },
  {
    id: "how-we-use",
    heading: "3. How We Use Information",
    body: [
      {
        type: "ul",
        items: [
          "Operate the Service — create and secure your account, save and display your evaluations, boards, and predictions, and compute community stats, standings, and badges.",
          "Improve the Service — understand which features people use (via aggregated analytics) so we can fix what's broken and build what's useful.",
          "Communicate with you — respond to support requests, and, if applicable, send account-related notices.",
          "Keep the Service safe — enforce our Terms of Service and Community Guidelines, and detect abuse.",
        ],
      },
    ],
  },
  {
    id: "cookies-analytics",
    heading: "4. Cookies & Analytics",
    body: [
      { type: "p", text: "We use Firebase Authentication to keep you signed in, and analytics tools — including Google Analytics and Vercel Analytics — to understand traffic and usage patterns in aggregate. These tools may use cookies or similar technologies. See our Cookie Policy for the full list and your choices." },
    ],
  },
  {
    id: "sharing",
    heading: "5. How We Share Information",
    body: [
      { type: "p", text: "We don't sell your personal information. We share it only in these situations:" },
      {
        type: "ul",
        items: [
          "Service providers — companies that host and operate parts of the Service on our behalf, such as Google/Firebase (authentication, database, hosting) and analytics providers, under obligations to protect your data.",
          "Public by design — content you choose to make public (a public evaluation, a community board post, your username on a leaderboard) is visible to other visitors and users, that's the point of those features.",
          "Legal reasons — if required by law, subpoena, or legal process, or to protect the rights, property, or safety of We-Draft, our users, or the public.",
          "Business transfers — if We-Draft is ever involved in a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction, subject to this Policy or a successor policy.",
        ],
      },
    ],
  },
  {
    id: "retention",
    heading: "6. Data Retention",
    body: [
      { type: "p", text: "We keep your account information and content for as long as your account is active. If you delete your account or ask us to remove your data, we'll delete or anonymize it within a reasonable time, except where we need to keep certain records to comply with the law, resolve disputes, or enforce our agreements." },
    ],
  },
  {
    id: "your-rights",
    heading: "7. Your Rights & Choices",
    body: [
      { type: "p", text: "You can review and update most of your account information directly on your profile page. You can also ask us to access, correct, or delete your personal information by contacting us at the email below — we'll respond as required by applicable law (which may grant you additional rights depending on where you live, such as under the GDPR or CCPA)." },
      { type: "p", text: "You can opt out of Google Analytics using its browser add-on, and control cookies through your browser settings — see our Cookie Policy for details." },
    ],
  },
  {
    id: "childrens-privacy",
    heading: "8. Children's Privacy",
    body: [
      { type: "p", text: "The Service is not directed to children under 13, and we don't knowingly collect personal information from anyone under 13. If you believe a child under 13 has created an account or provided us information, please contact us and we'll delete it." },
    ],
  },
  {
    id: "security",
    heading: "9. Security",
    body: [
      { type: "p", text: "We rely on our infrastructure providers' (Google Firebase, Vercel) security practices and apply reasonable measures of our own to protect your information. No method of transmission or storage is 100% secure, though, so we can't guarantee absolute security." },
    ],
  },
  {
    id: "changes",
    heading: "10. Changes to This Policy",
    body: [
      { type: "p", text: "We may update this Privacy Policy from time to time. If we make material changes, we'll update the \"Last updated\" date above and, where appropriate, provide additional notice." },
    ],
  },
  {
    id: "contact",
    heading: "11. Contact Us",
    body: [
      { type: "p", text: "Questions about this Privacy Policy, or want to exercise a data right described above? Reach us at privacy@we-draft.com." },
    ],
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      description="What information We-Draft.com collects, how it's used, and your choices."
      lastUpdated="September 8, 2026"
      intro="Your privacy matters to us. This policy explains what we collect through We-Draft.com, why, and the choices available to you."
      sections={sections}
    />
  );
}
