import { capabilityTags, resolveModelCapabilities } from "@cococat/shared/model-capabilities";

type ModelCapabilityBadgesProps = {
  modelId: string;
  className?: string;
};

export function ModelCapabilityBadges({ modelId, className }: ModelCapabilityBadgesProps) {
  const caps = resolveModelCapabilities(modelId);
  const tags = capabilityTags(caps);
  return (
    <span className={className}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="mr-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {tag}
        </span>
      ))}
    </span>
  );
}
