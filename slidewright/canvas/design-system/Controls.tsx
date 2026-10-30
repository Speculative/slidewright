import type { ComponentPropsWithRef } from 'react';

// React-native ports of the supplied app controls. Keep native semantics,
// refs and event handlers so canvas focus, scrubbing and keyboard commands
// retain their existing contracts in both hosts.
type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} className={`sp-btn sp-btn-sm sp-btn-${variant} ${className}`} />;
}

export { Select } from './Select.js';

export function Switch({ children, className = '', ...props }: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return <label className={`sp-switch ${className}`}>
    <input {...props} type="checkbox" role="switch" />
    <span className="sp-switch-track" aria-hidden="true"><span className="sp-switch-knob" /></span>
    {children}
  </label>;
}
