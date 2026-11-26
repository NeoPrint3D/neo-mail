import { Tooltip } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { ArrowUUpLeftIcon, TrashIcon } from "@phosphor-icons/react";

export default function TrashActions({ onRecover, onDelete, disabled, compact }: {
	onRecover: () => void;
	onDelete: () => void;
	disabled?: boolean;
	compact?: boolean;
}) {
	if (compact) return <div className="flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
		<Tooltip content="Recover" asChild><Button type="button" variant="ghost" size="sm" shape="square" aria-label="Recover" disabled={disabled}
			icon={<ArrowUUpLeftIcon size={16} />} onClick={onRecover} /></Tooltip>
		<Tooltip content="Delete permanently" asChild><Button type="button" variant="ghost" size="sm" shape="square" aria-label="Delete permanently" disabled={disabled}
			icon={<TrashIcon size={16} />} onClick={onDelete} /></Tooltip>
	</div>;
	return <div className="trash-action-group flex items-center gap-1.5 whitespace-nowrap" role="group" aria-label="Trash actions">
		<Button type="button" variant="secondary" size="sm" disabled={disabled} icon={<ArrowUUpLeftIcon className="trash-action-icon" size={16} />} onClick={onRecover}>Recover</Button>
		<Button type="button" variant="destructive" size="sm" disabled={disabled} icon={<TrashIcon className="trash-action-icon" size={16} />} onClick={onDelete}>Delete permanently</Button>
	</div>;
}
