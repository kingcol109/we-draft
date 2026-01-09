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
  const { id } = useParams(); // id = ArticleSlug
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticle = async () => {
      try {
        const q = query(
          collection(db, "news"),
          where("slug", "==", id),
          where("active", "==", true)
        );

        const snap = await getDocs(q);

        if (!snap.empty) {
          setArticle({
            id: snap.docs[0].id,
            ...snap.docs[0].data(),
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

  if (!article || !article.long) {
    return (
      <p className="text-center mt-20">
        Article not found.
      </p>
    );
  }

  return (
    <>
      <Helmet>
        <title>{article.title} | We-Draft</title>
      </Helmet>

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
                <div className="mb-4 flex justify-end">
  <Link
    to="/news"
    className="px-4 py-2 rounded-lg font-extrabold uppercase text-sm hover:underline"
    style={{
      backgroundColor: SITE_GOLD,
      color: SITE_BLUE,
    }}
  >
    News
  </Link>
</div>

              <h1 className="text-3xl font-extrabold text-[#0055a5] mb-4">
                {article.title}
              </h1>

              <p className="text-gray-800 leading-relaxed whitespace-pre-line">
                {article.long}
              </p>

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
