// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ButtonHTMLAttributes } from 'react';

interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** When set, the button is disabled and this is its tooltip (for example "You can only edit your own profile"). */
  disabledReason?: string | undefined;
  primary?: boolean;
  danger?: boolean;
  small?: boolean;
}

/**
 * A button that can be disabled with a reason. It uses aria-disabled instead of `disabled`, so keyboard and
 * screen-reader users can still reach it and read why. It does nothing when clicked.
 */
export function ActionButton({
  disabledReason,
  primary,
  danger,
  small,
  className,
  onClick,
  ...rest
}: ActionButtonProps) {
  const classes = ['button', primary ? 'primary' : '', danger ? 'danger' : '', small ? 'small' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  if (disabledReason) {
    return (
      <button
        {...rest}
        type="button"
        className={`${classes} is-disabled`}
        aria-disabled="true"
        title={disabledReason}
        onClick={(event) => event.preventDefault()}
      />
    );
  }
  return <button {...rest} type="button" className={classes} onClick={onClick} />;
}
