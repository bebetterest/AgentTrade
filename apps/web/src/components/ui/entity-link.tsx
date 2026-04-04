import Link from "next/link";

type EntityLinkProps = {
  address: string;
  label: string;
  onClick?: () => void;
  href?: string;
};

export const EntityLink = ({ address, label, onClick, href }: EntityLinkProps) => {
  if (onClick) {
    return (
      <button type="button" className="link-btn inline-link" onClick={onClick}>
        {label}
      </button>
    );
  }
  if (href) {
    return <Link className="inline-link" href={href}>{label}</Link>;
  }
  return <span>{label}</span>;
};
