import { captionHtml, siteTitle, siteSlug, siteShortTitle } from "./sitePost";

jest.mock("../../firebase", () => ({ db: {}, auth: {} }));

test("caption → body: paragraphs, line breaks, we-draft.com links kept on the site", () => {
  const html = captionHtml("Today's Player Spotlight: A <b>B</b>\n\nGrade: 5th.\nTop strengths: Speed.\n\nGrade him yourself: we-draft.com/player/a-b-2027-rb.\n\n#NFLDraft");
  expect(html).toBe('<p>Today\'s Player Spotlight: A &lt;b&gt;B&lt;/b&gt;</p><p>Grade: 5th.<br>Top strengths: Speed.</p><p>Grade him yourself: <a href="/player/a-b-2027-rb">we-draft.com/player/a-b-2027-rb</a>.</p><p>#NFLDraft</p>');
  expect(captionHtml("Every pick at https://www.we-draft.com/mocks/2028")).toBe('<p>Every pick at <a href="/mocks/2028">https://www.we-draft.com/mocks/2028</a></p>');
  expect(captionHtml("we-draft.com")).toBe('<p><a href="/">we-draft.com</a></p>');
});

test("title and slug", () => {
  expect(siteTitle("\nToday's Player Spotlight: Aiden Flora, RB, Iowa State.\n\nmore")).toBe("Today's Player Spotlight: Aiden Flora, RB, Iowa State");
  expect(siteTitle("", "Spotlight · X")).toBe("Spotlight · X");
  expect(siteShortTitle("Today's Player Spotlight: Aiden Flora, RB, Iowa State")).toBe("Today's Player Spotlight: Aiden Flora");
  // The short title's words and the day, as ArticlesManager.js builds them.
  const at = new Date(2026, 10, 11, 15);
  expect(siteSlug(" Today's Player Spotlight: Aiden Flora ", at)).toBe(`todays-player-spotlight-aiden-flora-${new Date(2026, 10, 11).toISOString().slice(0, 10)}`);
});
