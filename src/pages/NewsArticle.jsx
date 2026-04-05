import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function NewsArticle() {
  useEffect(() => {
  const style = document.createElement("style");

  style.innerHTML = `
    .article-content a {
      color: #f6a21d;
      font-weight: 600;
      text-decoration: underline;
      cursor: pointer;
    }

    .article-content a:hover {
      color: #d48806;
      text-decoration: none;
    }
      .article-content p {
  margin-bottom: 16px;
}

.article-content strong {
  font-weight: 700;
}

.article-content h1,
.article-content h2,
.article-content h3 {
  margin-top: 20px;
  margin-bottom: 10px;
}
  .article-content {
  max-width: 700px;
  margin: 0 auto;
}
  `;

  document.head.appendChild(style);

  return () => document.head.removeChild(style);
}, []);
  const { id } = useParams(); // id = ArticleSlug
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticle = async () => {
      try {
// 🔵 TRY NEWS FIRST
const newsQuery = query(
  collection(db, "news"),
  where("slug", "==", id),
  where("active", "==", true)
);

const newsSnap = await getDocs(newsQuery);

if (!newsSnap.empty) {
  setArticle({
    id: newsSnap.docs[0].id,
    ...newsSnap.docs[0].data(),
  });
  return;
}

// 🟡 FALLBACK TO ARTICLES
const articleQuery = query(
  collection(db, "articles"),
  where("slug", "==", id),
  where("status", "==", "published")
);

const articleSnap = await getDocs(articleQuery);

if (!articleSnap.empty) {
  setArticle({
    id: articleSnap.docs[0].id,
    ...articleSnap.docs[0].data(),
  });
}
      } catch (err) {
        console.error("Error loading article:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchArticle();
  }, [id]);

  if (loading) {
    return (
      <p className="text-center mt-20 italic">
        Loading article…
      </p>
    );
  }

if (!article) {
    return (
      <p className="text-center mt-20">
        Article not found.
      </p>
    );
  }

const rawText =
  article.summary ||
  (article.content || article.long || "").replace(/<[^>]+>/g, "");

const description = rawText.slice(0, 160);

  const canonicalUrl = `https://we-draft.com/news/${article.slug}`;

  return (
    <>
      {/* ================= SEO ================= */}
      <Helmet>
        <title>{article.title} | We-Draft</title>

        <meta name="description" content={description} />

        {/* Canonical */}
        <link rel="canonical" href={canonicalUrl} />

        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={article.title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="We-Draft" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={article.title} />
        <meta name="twitter:description" content={description} />

        {/* Article metadata */}
        {article.publishedAt?.toDate && (
          <meta
            property="article:published_time"
            content={article.publishedAt.toDate().toISOString()}
          />
        )}
      </Helmet>
      {/* ======================================= */}

      <div className="min-h-screen bg-white px-4 pt-10 flex justify-center">
        <div className="w-full max-w-3xl">

          {/* Header */}
          <div
            className="border-4 rounded-xl mb-6"
            style={{ borderColor: SITE_GOLD }}
          >
            <div
              className="rounded-t-lg px-6 py-4 text-center font-extrabold text-2xl"
              style={{ backgroundColor: SITE_BLUE, color: "white" }}
            >
              {article.publishedAt?.toDate?.().toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>

            <div className="p-6">
<div
  style={{
    position: "relative",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: "20px",
  }}
>
  {/* TITLE */}
  <h1
    className="text-3xl font-extrabold"
    style={{
      color: SITE_BLUE,
      textAlign: "center",
    }}
  >
    {article.title}
  </h1>
{article.author && (
  <div
    style={{
      textAlign: "center",
      fontWeight: 700,
      fontSize: 16,
      marginTop: 6,
      color: "#444",
    }}
  >
    By {article.author}
  </div>
)}
  {/* NEWS BUTTON */}
  <Link
    to="/news"
    style={{
      position: "absolute",
      right: 0,
      backgroundColor: SITE_GOLD,
      color: SITE_BLUE,
      fontWeight: "bold",
      padding: "6px 12px",
      borderRadius: "8px",
      textTransform: "uppercase",
      fontSize: "12px",
    }}
  >
    News
  </Link>
</div>
              
<div
  className="text-gray-800 article-content"
  style={{
    fontSize: "18px",
    lineHeight: "1.8",
  }}
  dangerouslySetInnerHTML={{
    __html: article.content || article.long,
  }}
/>

              {/* Mentioned Players */}
              {Array.isArray(article.slugs) && article.slugs.length > 0 && (
                <div className="mt-8 pt-4 border-t">
                  <h3 className="font-extrabold text-lg mb-2">
                    Mentioned Players:
                  </h3>

                  <ul className="space-y-1">
                    {article.slugs.map((slug) => {
                      const name = slug
                        .replace(/-\d{4}.*/, "")
                        .replace(/-/g, " ")
                        .replace(/\b\w/g, (l) => l.toUpperCase());

                      return (
                        <li key={slug}>
                          <Link
                            to={`/player/${slug}`}
                            className="font-bold text-[#0055a5] hover:underline"
                          >
                            {name}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
