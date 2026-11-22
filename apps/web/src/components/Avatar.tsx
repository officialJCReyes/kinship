// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react';
import { photoUrl } from '../lib/photos.js';

export type AvatarSize = 'sm' | 'md' | 'lg';

/**
 * A round picture of a person: their profile photo when they have one, their initials when they do not (or when the picture
 * cannot be loaded). It is decoration: the person's name is always written beside it, so the image has alt="" and the initials are
 * hidden from screen readers. The small 192 px variant is used at every size.
 */
export function Avatar({
  photoMediaId,
  initials,
  size = 'md',
  className = '',
}: {
  photoMediaId?: string | null | undefined;
  initials: string;
  size?: AvatarSize;
  className?: string;
}) {
  // A failed picture is remembered by its id, so a different photo gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const show = photoMediaId && failed !== photoMediaId ? photoMediaId : null;
  return (
    <span className={`ava ava-${size}${className ? ` ${className}` : ''}`} aria-hidden="true">
      {initials}
      {show ? (
        <img
          key={show}
          src={photoUrl(show, 'avatar')}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(show)}
        />
      ) : null}
    </span>
  );
}
