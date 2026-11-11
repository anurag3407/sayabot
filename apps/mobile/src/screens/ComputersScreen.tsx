import React, { useEffect, useState } from "react"
import {
  Alert,
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  Cpu,
  Globe,
  Power,
  RefreshCw,
  Server,
} from "lucide-react-native"
import { supabase } from "../core/supabase"
import { currentWebApiUrl } from "../core/settings"
import { usePalette } from "../hooks/usePalette"
import { colors, fonts } from "../theme"
import type { ComputerContainerState } from "../types"

export function ComputersScreen() {
  const theme = usePalette()
  const [computers, setComputers] = useState<ComputerContainerState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchComputers = async () => {
    setLoading(true)
    setError(null)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setComputers([])
        setError("Sign in to see agent computers.")
        return
      }

      const { data, error: queryError } = await supabase
        .from("agent_computers")
        .select("agent_id, status, container_id, container_ip, profile, error, agents(handle)")
        .limit(30)
      if (queryError) throw queryError

      setComputers(
        (data ?? []).map((row) => {
          const agent = Array.isArray(row.agents) ? row.agents[0] : row.agents
          return {
            agentId: row.agent_id,
            agentHandle: agent?.handle || "agent",
            status: row.status,
            containerId: row.container_id,
            ip: row.container_ip,
            profile: row.profile === "browser" ? "browser" : "standard",
            error: row.error,
          }
        }),
      )
    } catch (e) {
      console.error("[ComputersScreen] error:", e)
      setComputers([])
      setError(e instanceof Error ? e.message : "Could not load computers.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchComputers()
  }, [])

  const handleTogglePower = (item: ComputerContainerState) => {
    Alert.alert(
      "Stop computer",
      `Stop the computer for @${item.agentHandle}? Commands that are running will be cut off.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop",
          style: "destructive",
          onPress: async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession()
              if (!session) {
                Alert.alert("Sign in required", "Sign in before stopping a computer.")
                return
              }
              const res = await fetch(`${currentWebApiUrl()}/api/v1/computers/${item.agentId}/stop`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
              })
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string }
                Alert.alert("Computer still running", body.error || "The stop request did not succeed.")
                return
              }
              setComputers((prev) =>
                prev.map((c) =>
                  c.agentId === item.agentId ? { ...c, status: "stopped" } : c
                )
              )
            } catch (err) {
              console.error("Power action failed:", err)
              Alert.alert("Computer still running", "The stop request did not succeed.")
            }
          },
        },
      ]
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.surface} />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <View>
          <Text style={styles.title}>Agent Computers</Text>
          <Text style={styles.subtitle}>Linux computers assigned to agents</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchComputers}>
          <RefreshCw size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Containers List */}
      <FlatList
        data={computers}
        keyExtractor={(item) => item.agentId}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchComputers} tintColor={colors.primary} />
        }
        renderItem={({ item }) => {
          const isRunning = item.status === "running"
          return (
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.cardTop}>
                <View style={styles.agentInfo}>
                  <View style={styles.agentAvatar}>
                    <Cpu size={20} color={colors.primaryBright} />
                  </View>
                  <View>
                    <Text style={styles.handle}>@{item.agentHandle}</Text>
                    <Text style={styles.containerName}>
                        {item.containerId ? `ID: ${item.containerId}` : "No container yet"}
                      </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.statusBadge,
                    isRunning ? styles.bgRunning : styles.bgStopped,
                  ]}
                >
                  <View
                    style={[
                      styles.pulsingDot,
                      isRunning ? styles.dotRunning : styles.dotStopped,
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      isRunning ? styles.textRunning : styles.textStopped,
                    ]}
                  >
                    {item.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Sandbox Specs Grid */}
              <View style={[styles.detailsGrid, { backgroundColor: theme.surfaceLight, borderColor: theme.borderSubtle }]}>
                <View style={styles.detailItem}>
                  <Globe size={13} color={colors.textSecondary} />
                  <Text style={styles.detailText}>
                    Profile: {item.profile === "browser" ? "Browser" : "Standard"}
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <Server size={13} color={colors.textSecondary} />
                  <Text style={styles.detailText}>{item.ip ? `Address: ${item.ip}` : "No address yet"}</Text>
                </View>
                {item.error ? (
                  <Text style={styles.detailText}>{item.error}</Text>
                ) : null}
              </View>

              {/* Card Footer Actions */}
              <View style={styles.cardFooter}>
                {isRunning ? (
                <TouchableOpacity
                  style={[styles.powerBtn, styles.powerBtnStop]}
                  onPress={() => handleTogglePower(item)}
                  activeOpacity={0.7}
                >
                  <Power size={13} color={isRunning ? colors.accentDanger : colors.primaryBright} />
                  <Text
                    style={[
                      styles.powerBtnText,
                      isRunning ? styles.powerTextStop : styles.powerTextStart,
                    ]}
                  >
                    Stop computer
                  </Text>
                </TouchableOpacity>
                ) : (
                  <Text style={styles.detailText}>
                    {item.status === "stopped" || item.status === "none"
                      ? "This computer is not running."
                      : `Status: ${item.status.replaceAll("_", " ")}`}
                  </Text>
                )}
              </View>
            </View>
          )
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Server size={36} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>{error ? "Computers are unavailable" : "No agent computers yet"}</Text>
              <Text style={styles.emptySubtitle}>
                {error ?? "A computer shows up here after an agent is given one."}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.primaryBright,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  refreshBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  list: {
    padding: 12,
    paddingBottom: 90,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  agentInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  agentAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  handle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  containerName: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.mono,
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotRunning: {
    backgroundColor: colors.primaryBright,
  },
  dotStopped: {
    backgroundColor: colors.accentDanger,
  },
  bgRunning: {
    backgroundColor: "rgba(37, 211, 102, 0.12)",
  },
  bgStopped: {
    backgroundColor: colors.accentDangerBg,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
  },
  textRunning: {
    color: colors.primaryBright,
  },
  textStopped: {
    color: colors.accentDanger,
  },
  detailsGrid: {
    gap: 6,
    backgroundColor: colors.surfaceLight,
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: colors.borderSubtle,
  },
  terminalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  terminalBtnText: {
    color: colors.primaryBright,
    fontSize: 12,
    fontWeight: "700",
  },
  powerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  powerBtnStop: {
    backgroundColor: colors.accentDangerBg,
    borderColor: "rgba(241, 92, 109, 0.3)",
  },
  powerBtnStart: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primary,
  },
  powerBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  powerTextStop: {
    color: colors.accentDanger,
  },
  powerTextStart: {
    color: colors.primaryBright,
  },
  empty: {
    padding: 40,
    alignItems: "center",
    gap: 12,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    maxWidth: 280,
  },
})
