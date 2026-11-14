import { renderEmailShell } from "./base"

export function renderWorkspaceInviteTemplate({
  inviterName,
  workspaceName,
  role,
  joinUrl,
  isExistingUser,
}: {
  inviterName?: string | null
  workspaceName: string
  role: string
  joinUrl: string
  isExistingUser?: boolean
}): { subject: string; html: string; text: string } {
  const inviter = inviterName ? inviterName : "A teammate"
  const subject = `${inviter} invited you to join ${workspaceName} on Sayalabs`
  const previewText = `${inviter} has invited you to collaborate in ${workspaceName}`

  const roleBadge = role === "admin" ? "Workspace Admin" : "Member"

  const actionText = isExistingUser
    ? "Open Workspace"
    : "Accept Invitation & Join"

  const description = isExistingUser
    ? `You have been added to <strong>${workspaceName}</strong> as a <strong>${roleBadge}</strong>. Click below to jump straight to the workspace.`
    : `You've been invited by <strong>${inviter}</strong> to join <strong>${workspaceName}</strong> as a <strong>${roleBadge}</strong>. Accept the invitation to access persistent chat, multi-agent tools, and shared canvases.`

  const contentHtml = `
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.3px;">
      You're invited to collaborate
    </h1>
    <p style="margin: 0 0 24px 0; color: #a1a1aa; font-size: 15px; line-height: 1.6;">
      ${description}
    </p>

    <!-- Workspace Details Card -->
    <div style="background-color: #121a14; border: 1px solid #1f3024; border-radius: 8px; padding: 20px 24px; margin: 0 0 28px 0;">
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td>
            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #71717a; display: block; margin-bottom: 4px;">
              Workspace
            </span>
            <span style="font-size: 16px; font-weight: 600; color: #ffffff;">
              ${workspaceName}
            </span>
          </td>
          <td align="right">
            <span style="display: inline-block; padding: 4px 10px; border-radius: 6px; background-color: #16241b; color: #34d399; font-size: 12px; font-weight: 600;">
              ${roleBadge}
            </span>
          </td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0 32px 0;">
      <a href="${joinUrl}" style="display: inline-block; background-color: #34d399; color: #070907; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px; box-shadow: 0 2px 8px rgba(52, 211, 153, 0.25);">
        ${actionText}
      </a>
    </div>

    <p style="margin: 0; color: #71717a; font-size: 12px; line-height: 1.5; border-top: 1px solid #19211b; padding-top: 20px;">
      Direct link:<br>
      <a href="${joinUrl}" style="color: #34d399; text-decoration: underline; word-break: break-all;">${joinUrl}</a>
    </p>
  `

  const text = `${inviter} invited you to join ${workspaceName} (${roleBadge}) on Sayalabs.\n\nOpen link to join: ${joinUrl}\n\nIf you did not expect this invitation, you can ignore this email.`

  return {
    subject,
    html: renderEmailShell({ title: subject, previewText, contentHtml }),
    text,
  }
}

export function renderRoomInviteTemplate({
  inviterName,
  roomName,
  joinUrl,
}: {
  inviterName?: string | null
  roomName: string
  joinUrl: string
}): { subject: string; html: string; text: string } {
  const inviter = inviterName ? inviterName : "A teammate"
  const subject = `${inviter} invited you to #${roomName} on Sayalabs`
  const previewText = `${inviter} added you to #${roomName}`

  const contentHtml = `
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.3px;">
      New room invitation
    </h1>
    <p style="margin: 0 0 24px 0; color: #a1a1aa; font-size: 15px; line-height: 1.6;">
      <strong>${inviter}</strong> has invited you to join the room <strong>#${roomName}</strong>.
    </p>

    <div style="text-align: center; margin: 28px 0 32px 0;">
      <a href="${joinUrl}" style="display: inline-block; background-color: #34d399; color: #070907; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px; box-shadow: 0 2px 8px rgba(52, 211, 153, 0.25);">
        Open #${roomName}
      </a>
    </div>

    <p style="margin: 0; color: #71717a; font-size: 12px; line-height: 1.5; border-top: 1px solid #19211b; padding-top: 20px;">
      Direct link:<br>
      <a href="${joinUrl}" style="color: #34d399; text-decoration: underline; word-break: break-all;">${joinUrl}</a>
    </p>
  `

  const text = `${inviter} invited you to #${roomName} on Sayalabs.\n\nOpen room: ${joinUrl}`

  return {
    subject,
    html: renderEmailShell({ title: subject, previewText, contentHtml }),
    text,
  }
}
