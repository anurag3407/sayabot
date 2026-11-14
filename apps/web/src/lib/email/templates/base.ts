export interface BaseEmailShellProps {
  title: string
  previewText?: string
  contentHtml: string
}

export function renderEmailShell({
  title,
  previewText,
  contentHtml,
}: BaseEmailShellProps): string {
  const preview = previewText
    ? `<div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${previewText}</div>`
    : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#070907;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  ${preview}
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#070907;width:100%;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:540px;background-color:#0d110e;border:1px solid #1f2821;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td style="padding:32px 36px 20px 36px;border-bottom:1px solid #19211b;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size:20px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;text-decoration:none;">
                      Saya<span style="color:#34d399;">labs</span>
                    </span>
                  </td>
                  <td align="right">
                    <span style="display:inline-block;padding:3px 8px;border-radius:12px;background-color:#16241b;color:#34d399;font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">
                      Platform
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding:36px;color:#d4d4d8;font-size:15px;line-height:1.6;">
              ${contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 36px;background-color:#090d0a;border-top:1px solid #19211b;color:#71717a;font-size:12px;line-height:1.5;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <p style="margin:0 0 6px 0;color:#a1a1aa;font-weight:500;">
                      Sayalabs Studio &middot; Autonomous Multi-Agent Workspace
                    </p>
                    <p style="margin:0;color:#52525b;">
                      If you did not initiate this request, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
