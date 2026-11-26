import { Button as KumoButton } from "@cloudflare/kumo";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

type ButtonProps = ComponentPropsWithoutRef<typeof KumoButton>;

// Keep the library's loading indicators, sizing and ref forwarding, but use
// NeoMail's palette instead of the Cloudflare brand button styles.
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", className, ...props }, ref) {
	return <KumoButton ref={ref} variant="ghost" className={`mail-ui-button${className ? ` ${className}` : ""}`}
		data-appearance={variant} {...props} />;
});

export default Button;
