// src/pages/CommunityGuidelines.jsx
import LegalPageLayout from "../components/LegalPageLayout";

const sections = [
  {
    id: "purpose",
    heading: "1. Why We Have Guidelines",
    body: [
      { type: "p", text: "We-Draft works because real people share real scouting opinions. These Guidelines exist to keep that community useful, honest, and welcoming — for the die-hard scout and the casual fan alike. They apply on top of our Terms of Service, and we can remove content or restrict accounts that don't follow them." },
    ],
  },
  {
    id: "where-this-applies",
    heading: "2. Where This Applies",
    body: [
      { type: "p", text: "These Guidelines cover everything you post or submit on We-Draft: scouting evaluations and grades, strengths/weaknesses and NFL fit tags, your free-text \"Scout's Take,\" per-game notes, community board posts and comments, mock draft boards and names, usernames, and any other user-generated content." },
    ],
  },
  {
    id: "be-respectful",
    heading: "3. Be Respectful",
    body: [
      {
        type: "ul",
        items: [
          "No harassment, threats, hate speech, or content that attacks someone based on race, ethnicity, religion, gender, sexual orientation, disability, or other protected characteristics.",
          "Disagree with a grade or a take all you want — that's the whole point — but keep it about the football, not personal attacks on other users.",
          "No doxxing or sharing anyone's private information (yours or someone else's) without consent.",
          "Remember every player evaluated on this site is a real person, often a college student — critique the game, not the person.",
        ],
      },
    ],
  },
  {
    id: "keep-it-real",
    heading: "4. Keep It Real",
    body: [
      {
        type: "ul",
        items: [
          "Post your own honest scouting opinion. Don't copy someone else's written evaluation or report and pass it off as your own.",
          "Don't impersonate another person, scout, media member, or organization, or misrepresent who you are.",
          "Don't manipulate community stats — creating multiple accounts to inflate grades, standings, or We-Pick results is not allowed.",
        ],
      },
    ],
  },
  {
    id: "no-spam",
    heading: "5. No Spam or Abuse",
    body: [
      { type: "p", text: "Don't use evaluations, comments, usernames, or mock draft names to post spam, unrelated advertising, or repeated self-promotion. Automated posting or scripted account activity isn't allowed." },
    ],
  },
  {
    id: "profanity",
    heading: "6. Language & Automated Filtering",
    body: [
      { type: "p", text: "We run public-facing text (like evaluations and game notes) through an automated profanity filter, and content that trips it may be blocked from posting or hidden from public view. Keep it clean — this is a site people bring their whole family to for draft season." },
    ],
  },
  {
    id: "prohibited",
    heading: "7. Never Allowed",
    body: [
      {
        type: "ul",
        items: [
          "Illegal content of any kind.",
          "Sexual content involving minors, or any content that sexualizes or exploits minors — this includes content about a player who is a minor.",
          "Content that promotes self-harm, violence, or illegal activity.",
          "Malware, phishing links, or attempts to compromise other users' accounts.",
        ],
      },
    ],
  },
  {
    id: "enforcement",
    heading: "8. Enforcement",
    body: [
      { type: "p", text: "Depending on the severity and history involved, we may remove content, hide it from public view, restrict features, or suspend or terminate an account — at our discretion, with or without prior notice. We aim to be fair and consistent, but reserve the right to make judgment calls to keep the community healthy." },
    ],
  },
  {
    id: "reporting",
    heading: "9. Reporting Something",
    body: [
      { type: "p", text: "See something that violates these Guidelines? Let us know at abuse@we-draft.com with a link or enough detail to find it — we review every report." },
    ],
  },
];

export default function CommunityGuidelines() {
  return (
    <LegalPageLayout
      title="Community Guidelines"
      description="The rules for evaluations, comments, and everything else the We-Draft community posts."
      lastUpdated="September 8, 2026"
      intro="We-Draft is built on real scouting opinions from real fans. These Guidelines keep that community sharp, honest, and welcoming."
      sections={sections}
    />
  );
}
