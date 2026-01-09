import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function News() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const q = query(
          collection(db, "news"),
          where("active", "==", true),
          orderBy("publishedAt", "desc")
        );

        const snap = await getDocs(q);
        setNews(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        );
      } catch (err) {
        console.error("Error fetching news:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, []);

  return (
    <>
      <Helmet>
        <title>News | We-Draft.com</title>
      </Helmet>

      <div className="bg-white min-h-screen px-4 pt-10 flex justify-center">
        <div className="w-full max-w-4xl">

          {/* Page Header */}
          <div
            className="border-4 rounded-xl mb-8"
            style={{ borderColor: SITE_GOLD }}
          >
            <div
              className="rounded-t-lg px-6 py-4 text-center font-extrabold text-3xl uppercase"
              style={{ backgroundColor: SITE_BLUE, color: "white" }}
            >
              News
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <p className="text-center italic text-gray-500">
              Loading news…
            </p>
          ) : news.length ? (
            <div className="space-y-4">
              {news.map((n) => (
                <div
                  key={n.slug || n.id}
                  className="bg-white border-2 rounded-xl p-4 hover:bg-[#f9fbff] transition"
                  style={{ borderColor: SITE_GOLD }}
                >
                  {/* Headline */}
                  {n.long && n.slug ? (
                    <Link
                      to={`/news/${n.slug}`}
                      className="font-extrabold text-lg hover:underline"
                      style={{ color: SITE_BLUE }}
                    >
                      <span className="mr-2">
                        {n.publishedAt?.toDate?.().toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                        :
                      </span>
                      {n.title}
                    </Link>
                  ) : (
                    <div className="font-extrabold text-lg text-gray-500 cursor-default">
                      <span className="mr-2">
                        {n.publishedAt?.toDate?.().toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                        :
                      </span>
                      {n.title}
                    </div>
                  )}

                  {/* Optional summary */}
                  {n.summary && (
                    <p className="mt-2 text-gray-700">
                      {n.summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center italic text-gray-500">
              No news available.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
