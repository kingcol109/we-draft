// src/pages/TermsOfService.jsx
import LegalPageLayout from "../components/LegalPageLayout";

const sections = [
  {
    id: "acceptance",
    heading: "1. Acceptance of Terms",
    body: [
      { type: "p", text: "These Terms of Service (\"Terms\") govern your access to and use of We-Draft.com, including our website, accounts, and every feature we offer (collectively, the \"Service\"), operated by We-Draft (\"We-Draft,\" \"we,\" \"us,\" or \"our\"). By creating an account, or by otherwise accessing or using the Service, you agree to be bound by these Terms and by our Privacy Policy and Community Guidelines, which are incorporated here by reference. If you don't agree, please don't use the Service." },
    ],
  },
  {
    id: "eligibility",
    heading: "2. Eligibility & Accounts",
    body: [
      { type: "p", text: "You must be at least 13 years old to create an account. By registering, you confirm that you meet this requirement and that the information you provide (email address, username, and anything else we ask for) is accurate." },
      { type: "p", text: "You're responsible for keeping your login credentials secure and for all activity that happens under your account, whether you signed up with an email/password or through Google sign-in. Let us know right away if you believe your account has been compromised." },
    ],
  },
  {
    id: "service",
    heading: "3. The Service",
    body: [
      { type: "p", text: "We-Draft is a community-powered NFL Draft scouting platform. Depending on what's live at any given time, that includes player and team pages, community scouting evaluations and grades, per-game scouting notes, mock draft boards, the We-Pick prediction game, a community discussion board, news and video content, and related features." },
      { type: "p", text: "We may add, change, or remove features at any time, including ones you rely on, without notice or liability to you." },
    ],
  },
  {
    id: "user-content",
    heading: "4. Your Content",
    body: [
      { type: "p", text: "\"User Content\" means anything you submit through the Service — scouting evaluations, grades, strengths/weaknesses/NFL fit tags, game notes, community board posts and comments, mock draft boards, usernames, and anything else you post." },
      { type: "p", text: "You keep ownership of your User Content. By submitting it, you grant We-Draft a worldwide, non-exclusive, royalty-free, sublicensable license to host, store, reproduce, display, and distribute it as part of operating and promoting the Service — for example, showing your public evaluation on a player's page, or including your mock draft in a shareable image or link." },
      { type: "p", text: "You're solely responsible for your User Content and confirm you have the rights to post it and that it doesn't violate these Terms, our Community Guidelines, or the law. We can remove or refuse to display any User Content, and suspend or terminate accounts, at our discretion — see our Community Guidelines for the standards we enforce." },
    ],
  },
  {
    id: "we-pick",
    heading: "5. We-Pick & Other Prediction Features",
    body: [
      { type: "p", text: "We-Pick is a free-to-play prediction game for entertainment purposes only. There is no purchase necessary to participate, and standings, badges (like Sweep, Snipe, Top Dog, and Immaculate), and any other in-Service recognition have no cash or monetary value and cannot be redeemed, transferred, or exchanged for anything of value." },
      { type: "p", text: "We-Pick is not a gambling or wagering product. Scores, standings, and badges are computed automatically from publicly available game results according to rules we may adjust from time to time, and final grading decisions are ours." },
    ],
  },
  {
    id: "acceptable-use",
    heading: "6. Acceptable Use",
    body: [
      { type: "p", text: "In addition to our Community Guidelines, when using the Service you agree not to:" },
      {
        type: "ul",
        items: [
          "Violate any law, or the rights of any other person or organization.",
          "Scrape, crawl, or use automated means to access or collect data from the Service beyond normal, incidental use, without our prior written permission.",
          "Attempt to gain unauthorized access to any account, system, or data, or interfere with the Service's normal operation (including via bots, exploits, or manipulating We-Pick scoring/badges).",
          "Impersonate any person or entity, or misrepresent your affiliation with anyone.",
          "Upload or transmit viruses, malware, or other harmful code.",
          "Use the Service to send spam or unauthorized advertising.",
        ],
      },
    ],
  },
  {
    id: "third-party",
    heading: "7. Third-Party Content & Links",
    body: [
      { type: "p", text: "The Service links to or embeds third-party content — video breakdowns hosted on platforms like YouTube, social media, news sources, and occasionally affiliate/merchandise links. We don't control that content and aren't responsible for it; visiting a third-party site or service is at your own risk and subject to that third party's own terms and privacy practices." },
      { type: "p", text: "We-Draft is an independent, fan-operated platform and is not affiliated with, endorsed by, or sponsored by the NFL, the NCAA, any conference, team, school, or player association. Team names, logos, and player names/likenesses referenced on the Service belong to their respective owners and are used for identification and commentary purposes only." },
    ],
  },
  {
    id: "intellectual-property",
    heading: "8. Our Intellectual Property",
    body: [
      { type: "p", text: "The Service itself — its design, code, layout, compiled statistics, original written content, and the We-Draft name and logo — is owned by We-Draft or its licensors and protected by copyright, trademark, and other laws. Other than the license you grant us to your own User Content, nothing in these Terms transfers any of that ownership to you, and you may not copy, modify, or redistribute the Service or its content except as the Service itself allows (for example, sharing a scouting report or mock draft using the share features we provide)." },
    ],
  },
  {
    id: "disclaimers",
    heading: "9. Disclaimers",
    body: [
      { type: "p", text: "Scouting grades, evaluations, mock drafts, predictions, and community content on We-Draft reflect personal opinions — ours and other users' — not guarantees, professional advice, or certainty about any player's future performance, draft position, or career outcome. Statistical and schedule data is sourced from third parties and, while we try to keep it accurate, may contain errors." },
      { type: "p", text: "THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE,\" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR THAT THE SERVICE WILL BE ACCURATE, UNINTERRUPTED, OR ERROR-FREE." },
    ],
  },
  {
    id: "liability",
    heading: "10. Limitation of Liability",
    body: [
      { type: "p", text: "TO THE FULLEST EXTENT PERMITTED BY LAW, WE-DRAFT AND ITS OPERATORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, GOODWILL, OR PROFITS, ARISING FROM YOUR USE OF (OR INABILITY TO USE) THE SERVICE, EVEN IF WE'VE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF (A) THE AMOUNT YOU PAID US, IF ANY, IN THE 12 MONTHS BEFORE THE CLAIM, OR (B) $50." },
      { type: "p", text: "Some jurisdictions don't allow the exclusion or limitation of certain damages, so some of the above limitations may not apply to you." },
    ],
  },
  {
    id: "termination",
    heading: "11. Suspension & Termination",
    body: [
      { type: "p", text: "You may stop using the Service, or ask us to delete your account, at any time. We may suspend or terminate your access to the Service — including removing your User Content — at any time, for any reason, including a violation of these Terms or our Community Guidelines, with or without notice." },
    ],
  },
  {
    id: "changes",
    heading: "12. Changes to These Terms",
    body: [
      { type: "p", text: "We may update these Terms from time to time. If we make material changes, we'll update the \"Last updated\" date above and, where appropriate, provide additional notice. Continuing to use the Service after changes take effect means you accept the updated Terms." },
    ],
  },
  {
    id: "governing-law",
    heading: "13. Governing Law",
    body: [
      { type: "p", text: "These Terms are governed by the laws of the United States and the state in which We-Draft's operator resides, without regard to conflict-of-laws principles, unless otherwise required by applicable law." },
    ],
  },
  {
    id: "contact",
    heading: "14. Contact Us",
    body: [
      { type: "p", text: "Questions about these Terms? Reach us at legal@we-draft.com." },
    ],
  },
];

export default function TermsOfService() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      description="The terms that govern your use of We-Draft.com — accounts, user content, We-Pick, and more."
      lastUpdated="September 8, 2026"
      intro="Welcome to We-Draft. These Terms of Service explain the rules for using our site — please read them alongside our Privacy Policy and Community Guidelines."
      sections={sections}
    />
  );
}
