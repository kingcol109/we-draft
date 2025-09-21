import { Link } from "react-router-dom";

export default function PlayerCard({ player }) {
  return (
    <div style={{ border: "1px solid #ccc", margin: "1rem", padding: "1rem" }}>
      <h3>{player.name}</h3>
      <p>{player.position} - {player.school}</p>
      <Link to={`/player/${player.id}`}>View Profile</Link>
    </div>
  );
}
