export default function BrandMark({ className = "" }: { className?: string }) {
	return <img src="/icons/inbox.svg" width={40} height={40} className={`brand-mark ${className}`} alt="" />;
}
