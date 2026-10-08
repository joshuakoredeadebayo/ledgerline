const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The invitation email: a plain, single-button message that renders everywhere. */
export function invitationEmail(input: {
  organizationName: string;
  inviterEmail: string;
  roleLabel: string;
  link: string;
  expiresOn: string;
}) {
  const org = escapeHtml(input.organizationName);
  const inviter = escapeHtml(input.inviterEmail);
  const role = escapeHtml(input.roleLabel);
  const link = escapeHtml(input.link);
  const expires = escapeHtml(input.expiresOn);

  const subject = `${input.inviterEmail} invited you to ${input.organizationName} on Ledgerline`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f8fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1b4c;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f8fd;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border:1px solid #e8eef6;border-radius:12px;padding:32px;">
            <tr>
              <td>
                <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#2f62f2;">Ledgerline</p>
                <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:600;color:#0f1b4c;">You&rsquo;re invited to join ${org}</h1>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#4a5a82;">
                  ${inviter} has invited you to ${org} on Ledgerline as <strong style="color:#0f1b4c;">${role}</strong>.
                  Choose a password to create your account and get started.
                </p>
                <p style="margin:0 0 24px;">
                  <a href="${link}" style="display:inline-block;background:#2f62f2;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">Accept invitation</a>
                </p>
                <p style="margin:0 0 6px;font-size:12px;line-height:18px;color:#66759a;">If the button doesn&rsquo;t work, paste this link into your browser:</p>
                <p style="margin:0 0 20px;font-size:12px;line-height:18px;word-break:break-all;"><a href="${link}" style="color:#2f62f2;">${link}</a></p>
                <p style="margin:0;font-size:12px;line-height:18px;color:#66759a;">
                  This invitation works once and expires on ${expires}. If you weren&rsquo;t expecting it, you can ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `You're invited to join ${input.organizationName} on Ledgerline`,
    "",
    `${input.inviterEmail} has invited you as ${input.roleLabel}.`,
    "Choose a password to create your account:",
    input.link,
    "",
    `This invitation works once and expires on ${input.expiresOn}. If you weren't expecting it, you can ignore this email.`,
  ].join("\n");

  return { subject, html, text };
}
