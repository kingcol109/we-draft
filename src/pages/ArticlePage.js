import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import { collection, query, where, getDocs } from "firebase/firestore";

export default function ArticlePage() {
  const { slug } = useParams();
  const [article, setArticle] = useState(null);

  useEffect(() => {
    const fetchArticle = async () => {
      const q = query(
        collection(db, "articles"),
        where("slug", "==", slug),
        where("status", "==", "published")
      );

      const snap = await getDocs(q);

      if (!snap.empty) {
        setArticle(snap.docs[0].data());
      }
    };

    fetchArticle();
  }, [slug]);

  if (!article) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <h1>{article.title}</h1>

      <div
        dangerouslySetInnerHTML={{ __html: article.content }}
      />
    </div>
  );
}