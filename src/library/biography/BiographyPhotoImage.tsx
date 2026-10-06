import { Person48Regular } from '@fluentui/react-icons';
import { useState } from 'react';

export function BiographyPhotoImage({
  url,
  label,
  missing,
}: {
  readonly url?: string;
  readonly label: string;
  readonly missing: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return url && url !== failed ? (
    <img src={url} alt={label} draggable={false} onError={() => setFailed(url)} />
  ) : (
    <span role="img" aria-label={missing}>
      <Person48Regular aria-hidden />
    </span>
  );
}
