import React from "react"
import { StyleSheet, Text, View } from "react-native"
import { AlertCircle, Bot, Clock, DollarSign, Flag } from "lucide-react-native"
import { colors } from "../../theme"
import type { TaskItem } from "../../types"

interface TaskCardProps {
  task: TaskItem
}

export function TaskCard({ task }: TaskCardProps) {
  const isDone = task.status === "done"
  const isBlocked = task.status === "blocked" || task.status === "stuck"
  const isInProgress = task.status === "in_progress"

  const statusColor = isDone
    ? colors.primaryBright
    : isBlocked
      ? colors.accentDanger
      : isInProgress
        ? colors.accentCyan
        : colors.textSecondary

  const priorityColor =
    task.priority === "urgent"
      ? colors.accentDanger
      : task.priority === "high"
        ? colors.accentWarning
        : task.priority === "medium"
          ? colors.accentCyan
          : colors.textSecondary

  const progressPercent = Math.min(100, Math.round((task.turnsUsed / Math.max(1, task.budgetTurns)) * 100))

  return (
    <View style={[styles.card, { borderLeftColor: statusColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.numberRow}>
          <Text style={styles.taskNumber}>#{task.number}</Text>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {task.status.replace("_", " ")}
            </Text>
          </View>
          <View style={[styles.priorityBadge, { backgroundColor: `${priorityColor}18` }]}>
            <Flag size={10} color={priorityColor} />
            <Text style={[styles.priorityText, { color: priorityColor }]}>
              {task.priority.toUpperCase()}
            </Text>
          </View>
        </View>

        {task.assigneeHandle && (
          <View style={styles.assigneeBadge}>
            <Bot size={13} color={colors.primaryBright} />
            <Text style={styles.assigneeText}>@{task.assigneeHandle}</Text>
          </View>
        )}
      </View>

      {/* Task Title */}
      <Text style={styles.title}>{task.title}</Text>

      {/* Description */}
      {task.description && (
        <Text style={styles.description} numberOfLines={2}>
          {task.description}
        </Text>
      )}

      {/* Unblock Banner */}
      {task.unblockNeeds && (
        <View style={styles.blockerAlert}>
          <AlertCircle size={14} color={colors.accentDanger} />
          <Text style={styles.blockerText} numberOfLines={2}>
            Needs: {task.unblockNeeds}
          </Text>
        </View>
      )}

      {/* Turns Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBarBg}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${progressPercent}%`,
                backgroundColor: isDone ? colors.primaryBright : colors.accentCyan,
              },
            ]}
          />
        </View>
      </View>

      {/* Footer Meta */}
      <View style={styles.footer}>
        <View style={styles.turnCounter}>
          <Clock size={12} color={colors.textSecondary} />
          <Text style={styles.turnsText}>
            {task.turnsUsed} / {task.budgetTurns} turns ({progressPercent}%)
          </Text>
        </View>

        {task.costUsd > 0 && (
          <View style={styles.costBadge}>
            <DollarSign size={11} color={colors.primaryBright} />
            <Text style={styles.costText}>{task.costUsd.toFixed(4)}</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  numberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  taskNumber: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10.5,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  priorityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: 9.5,
    fontWeight: "700",
  },
  assigneeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primaryDark,
  },
  assigneeText: {
    color: colors.primaryBright,
    fontSize: 11,
    fontWeight: "600",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  description: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  blockerAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accentDangerBg,
    padding: 8,
    borderRadius: 8,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(241, 92, 109, 0.3)",
  },
  blockerText: {
    color: colors.accentDanger,
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  progressContainer: {
    marginTop: 4,
    marginBottom: 6,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 6,
    borderTopWidth: 1,
    borderColor: colors.borderSubtle,
  },
  turnCounter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  turnsText: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  costBadge: {
    flexDirection: "row",
    alignItems: "center",
  },
  costText: {
    color: colors.primaryBright,
    fontSize: 11,
    fontWeight: "700",
  },
})
