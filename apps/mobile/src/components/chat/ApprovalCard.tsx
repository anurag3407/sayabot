import React, { useState } from "react"
import { StyleSheet, Text, Vibration, View } from "react-native"
import { Check, ShieldAlert, X } from "lucide-react-native"
import { useSettings } from "../../hooks/useSettings"
import { Button } from "../ui/Button"
import { colors, fonts } from "../../theme"
import type { PendingApproval } from "../../types"

interface ApprovalCardProps {
  approval: PendingApproval
  onResolve: (approved: boolean) => Promise<void>
}

export function ApprovalCard({ approval, onResolve }: ApprovalCardProps) {
  const { settings } = useSettings()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const formattedArgs = JSON.stringify(approval.args, null, 2)

  async function decide(approved: boolean) {
    if (pending) return
    setPending(true)
    setError(null)
    if (settings.hapticsEnabled) Vibration.vibrate(12)
    try {
      await onResolve(approved)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "That decision was not saved.")
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconBadge}>
          <ShieldAlert size={18} color={colors.accentWarning} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tool Approval Requested</Text>
          <Text style={styles.subtitle}>Human-in-the-loop safety verification</Text>
        </View>
      </View>

      <Text style={styles.body}>
        Agent requests permission to execute{" "}
        <Text style={styles.toolName}>{approval.toolName}</Text>:
      </Text>

      <View style={styles.codeBox}>
        <Text style={styles.codeText}>{formattedArgs}</Text>
      </View>

      <View style={styles.actions}>
        <Button
          title="Approve & Execute"
          variant="primary"
          icon={<Check size={16} color={colors.textInverse} />}
          style={styles.approveBtn}
          onPress={() => void decide(true)}
          disabled={pending}
        />
        <Button
          title="Reject"
          variant="danger"
          icon={<X size={16} color="#ffffff" />}
          style={styles.rejectBtn}
          onPress={() => void decide(false)}
          disabled={pending}
        />
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    margin: 12,
    padding: 14,
    backgroundColor: "rgba(234, 179, 8, 0.08)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accentWarning,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(234, 179, 8, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.accentGold,
    fontSize: 14.5,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 11.5,
  },
  body: {
    color: colors.textPrimary,
    fontSize: 13,
    marginBottom: 8,
    lineHeight: 18,
  },
  toolName: {
    color: colors.accentCyan,
    fontWeight: "700",
    fontFamily: fonts.mono,
  },
  codeBox: {
    backgroundColor: colors.codeBg,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: 12,
  },
  codeText: {
    color: "#5eead4",
    fontSize: 11.5,
    fontFamily: fonts.mono,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  approveBtn: {
    flex: 2,
    backgroundColor: colors.primary,
    paddingVertical: 10,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: colors.accentDangerBg,
    borderColor: colors.accentDanger,
    borderWidth: 1,
    paddingVertical: 10,
  },
  errorText: {
    color: colors.accentDanger,
    fontSize: 12.5,
    marginTop: 8,
  },
})
