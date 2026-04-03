import Link from "next/link";

interface DetailStateCardProps {
  title: string;
  body: string;
  actionHref: string;
  actionLabel: string;
}

export const DetailStateCard = ({
  title,
  body,
  actionHref,
  actionLabel
}: DetailStateCardProps) => {
  return (
    <section className="card detail-state-card">
      <h2>{title}</h2>
      <p className="sub">{body}</p>
      <Link href={actionHref}>{actionLabel}</Link>
    </section>
  );
};
