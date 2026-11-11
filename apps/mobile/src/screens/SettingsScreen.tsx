import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import {
  Bell,
  Bot,
  Brain,
  Check,
  ChevronRight,
  Cpu,
  Database,
  Edit2,
  Eye,
  EyeOff,
  Flame,
  Globe,
  Key,
  Lock,
  LogOut,
  Moon,
  RefreshCw,
  Server,
  Shield,
  Sliders,
  Sparkles,
  Terminal,
  Volume2,
  Wifi,
  X,
  Zap,
} from "lucide-react-native"
import { useAuth } from "../hooks/useAuth"
import { useSettings } from "../hooks/useSettings"
import { usePalette } from "../hooks/usePalette"
import { colors, fonts } from "../theme"

export function SettingsScreen() {
  const { user, signOut } = useAuth()
  const theme = usePalette()
  const {
    settings,
    updateSettings,
    resetAll,
    runDiagnostics,
    gatewayPing,
    databasePing,
    testingConnection,
  } = useSettings()

  // Modal states
  const [editNameModal, setEditNameModal] = useState(false)
  const [nameInput, setNameInput] = useState(settings.displayName)

  const [editOrgModal, setEditOrgModal] = useState(false)
  const [orgInput, setOrgInput] = useState(settings.orgSlug)

  const [apiKeyModal, setApiKeyModal] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState(settings.apiKey)
  const [showApiKey, setShowApiKey] = useState(false)

  const [editGatewayModal, setEditGatewayModal] = useState(false)
  const [gatewayInput, setGatewayInput] = useState(settings.webApiUrl)

  useEffect(() => {
    setNameInput(settings.displayName)
    setOrgInput(settings.orgSlug)
    setApiKeyInput(settings.apiKey)
    setGatewayInput(settings.webApiUrl)
  }, [settings])

  const handleSignOut = () => {
    const preview = !user
    Alert.alert(
      preview ? "Leave preview" : "Sign out",
      preview
        ? "Return to the sign-in screen?"
        : "Sign out of this account on this phone?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: preview ? "Leave" : "Sign out",
          style: "destructive",
          onPress: () => {
            void signOut()
          },
        },
      ]
    )
  }

  const handleResetDefaults = () => {
    Alert.alert(
      "Reset Settings",
      "Restore all settings, model keys, and gateway URLs to factory defaults?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            await resetAll()
            Alert.alert("Success", "Settings restored to factory defaults.")
          },
        },
      ]
    )
  }

  // Pre-configured AI models per provider
  const MODEL_OPTIONS: Record<string, string[]> = {
    openrouter: [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
    openai: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    gemini: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"],
    groq: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
  }

  const userInitials = (settings.displayName || user?.email || "U")
    .slice(0, 2)
    .toUpperCase()

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.surface} />

      {/* Screen Top Header */}
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <View>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.headerSubtitle}>Workspace, AI Engines & Sandbox Controls</Text>
        </View>
        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={() => runDiagnostics()}
          disabled={testingConnection}
        >
          {testingConnection ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <RefreshCw size={19} color={colors.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ============================================================== */}
        {/* 1. USER PROFILE & WORKSPACE CARD                               */}
        {/* ============================================================== */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Profile & Workspace</Text>
          <View style={styles.profileCard}>
            <View style={styles.profileRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{userInitials}</Text>
                <View style={styles.avatarOnlineDot} />
              </View>

              <View style={styles.profileDetails}>
                <View style={styles.nameRow}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {settings.displayName || "Operator"}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setEditNameModal(true)}
                    style={styles.pencilBtn}
                  >
                    <Edit2 size={13} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.userEmail} numberOfLines={1}>
                  {user?.email || "Not signed in"}
                </Text>

                <View style={styles.metaBadgeRow}>
                  <View style={styles.roleBadge}>
                    <Shield size={11} color={colors.primaryBright} />
                    <Text style={styles.roleText}>{settings.role}</Text>
                  </View>

                  <TouchableOpacity
                    style={styles.orgBadge}
                    onPress={() => setEditOrgModal(true)}
                  >
                    <Globe size={11} color={colors.accentCyan} />
                    <Text style={styles.orgText}>Org: @{settings.orgSlug}</Text>
                    <ChevronRight size={10} color={colors.accentCyan} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* ============================================================== */}
        {/* 2. AI MODEL PROVIDERS & BYOK (BRING YOUR OWN KEY)             */}
        {/* ============================================================== */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>AI Engine & Model BYOK</Text>
            <View style={styles.activeProviderBadge}>
              <Sparkles size={11} color={colors.primaryBright} />
              <Text style={styles.activeProviderText}>{settings.aiProvider.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.card}>
            {/* Provider Picker Pills */}
            <Text style={styles.cardLabel}>Model Provider</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.providerPillRow}
            >
              {(["openrouter", "anthropic", "openai", "deepseek", "gemini", "groq"] as const).map(
                (p) => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.providerPill,
                      settings.aiProvider === p && styles.providerPillActive,
                    ]}
                    onPress={() => {
                      const presets = MODEL_OPTIONS[p] || []
                      updateSettings({
                        aiProvider: p,
                        modelName: presets[0] || settings.modelName,
                      })
                    }}
                  >
                    <Text
                      style={[
                        styles.providerPillText,
                        settings.aiProvider === p && styles.providerPillTextActive,
                      ]}
                    >
                      {p.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </ScrollView>

            <View style={styles.divider} />

            {/* Model Name Selector */}
            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Brain size={18} color={colors.accentPurple} />
                <View>
                  <Text style={styles.rowTitle}>Default Model</Text>
                  <Text style={styles.rowSubtitle} numberOfLines={1}>
                    {settings.modelName}
                  </Text>
                </View>
              </View>
            </View>

            {/* Quick Model Presets */}
            <View style={styles.modelPresetRow}>
              {(MODEL_OPTIONS[settings.aiProvider] || []).map((m) => {
                const shortName = m.split("/").pop() || m
                const isSelected = settings.modelName === m
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.modelPresetChip, isSelected && styles.modelPresetChipActive]}
                    onPress={() => updateSettings({ modelName: m })}
                  >
                    <Text
                      style={[
                        styles.modelPresetText,
                        isSelected && styles.modelPresetTextActive,
                      ]}
                    >
                      {shortName}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <View style={styles.divider} />

            {/* API Key Vault Row */}
            <TouchableOpacity
              style={styles.rowBetween}
              onPress={() => setApiKeyModal(true)}
              activeOpacity={0.7}
            >
              <View style={styles.rowLead}>
                <Key size={18} color={colors.accentWarning} />
                <View>
                  <Text style={styles.rowTitle}>Custom BYOK API Key</Text>
                  <Text style={styles.rowSubtitle}>
                    {settings.apiKey
                      ? `Configured • ${settings.apiKey.slice(0, 7)}••••••••`
                      : "Default system key in use • Tap to add BYOK"}
                  </Text>
                </View>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Autonomous Turns & Temperature */}
            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Flame size={18} color={colors.accentGold} />
                <View>
                  <Text style={styles.rowTitle}>Max Autonomous Turns</Text>
                  <Text style={styles.rowSubtitle}>Budget limit per agent task run</Text>
                </View>
              </View>
              <View style={styles.stepperContainer}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() =>
                    updateSettings({
                      maxBudgetTurns: Math.max(3, settings.maxBudgetTurns - 1),
                    })
                  }
                >
                  <Text style={styles.stepperText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{settings.maxBudgetTurns}</Text>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() =>
                    updateSettings({
                      maxBudgetTurns: Math.min(60, settings.maxBudgetTurns + 1),
                    })
                  }
                >
                  <Text style={styles.stepperText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Zap size={18} color={colors.primaryBright} />
                <View>
                  <Text style={styles.rowTitle}>Creativity (Temperature)</Text>
                  <Text style={styles.rowSubtitle}>
                    {settings.temperature <= 0.3
                      ? "0.2 • Deterministic / Strict"
                      : settings.temperature >= 0.9
                        ? "1.0 • High Creativity"
                        : "0.7 • Balanced Default"}
                  </Text>
                </View>
              </View>
              <View style={styles.tempChipRow}>
                {[0.2, 0.7, 1.0].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.tempChip,
                      settings.temperature === val && styles.tempChipActive,
                    ]}
                    onPress={() => updateSettings({ temperature: val })}
                  >
                    <Text
                      style={[
                        styles.tempChipText,
                        settings.temperature === val && styles.tempChipTextActive,
                      ]}
                    >
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* ============================================================== */}
        {/* 3. GATEWAY & INFRASTRUCTURE                                    */}
        {/* ============================================================== */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Infrastructure & Gateway</Text>
          <View style={styles.card}>
            {/* VPS Gateway URL */}
            <TouchableOpacity
              style={styles.rowBetween}
              onPress={() => setEditGatewayModal(true)}
              activeOpacity={0.7}
            >
              <View style={styles.rowLead}>
                <Server size={18} color={colors.accentCyan} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>VPS API Host Gateway</Text>
                  <Text style={styles.rowSubtitle} numberOfLines={1}>
                    {settings.webApiUrl}
                  </Text>
                </View>
              </View>
              <View style={styles.rowTrail}>
                {gatewayPing && (
                  <View
                    style={[
                      styles.pingStatusBadge,
                      gatewayPing.ok ? styles.pingOk : styles.pingBad,
                    ]}
                  >
                    <Text
                      style={[
                        styles.pingStatusText,
                        gatewayPing.ok ? styles.pingOkText : styles.pingBadText,
                      ]}
                    >
                      {gatewayPing.latencyMs}ms
                    </Text>
                  </View>
                )}
                <ChevronRight size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Supabase Realtime Endpoint */}
            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Database size={18} color={colors.accentPurple} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Database & Realtime Channel</Text>
                  <Text style={styles.rowSubtitle} numberOfLines={1}>
                    {settings.supabaseUrl}
                  </Text>
                </View>
              </View>
              {databasePing && (
                <View
                  style={[
                    styles.pingStatusBadge,
                    databasePing.ok ? styles.pingOk : styles.pingBad,
                  ]}
                >
                  <Text
                    style={[
                      styles.pingStatusText,
                      databasePing.ok ? styles.pingOkText : styles.pingBadText,
                    ]}
                  >
                    {databasePing.latencyMs}ms
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.divider} />

            {/* Ping Test Trigger */}
            <TouchableOpacity
              style={styles.testConnectionBtn}
              onPress={() => runDiagnostics()}
              disabled={testingConnection}
              activeOpacity={0.8}
            >
              {testingConnection ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <>
                  <Wifi size={16} color={colors.textInverse} />
                  <Text style={styles.testConnectionBtnText}>Test Network Latency</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ============================================================== */}
        {/* 4. AGENT SANDBOX & SAFETY GUARDRAILS                           */}
        {/* ============================================================== */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Agent Sandbox & Execution</Text>
          <View style={styles.card}>
            {/* Tool Approval Policy */}
            <View style={styles.colBlock}>
              <View style={styles.rowLead}>
                <Shield size={18} color={colors.primaryBright} />
                <View>
                  <Text style={styles.rowTitle}>Danger Tool Approval Policy</Text>
                  <Text style={styles.rowSubtitle}>
                    Control when agent must ask before running commands
                  </Text>
                </View>
              </View>

              <View style={styles.segmentedRow}>
                {(
                  [
                    { id: "always_ask", label: "Always Ask" },
                    { id: "read_only_auto", label: "Auto Read" },
                    { id: "full_auto", label: "Full Auto" },
                  ] as const
                ).map((mode) => (
                  <TouchableOpacity
                    key={mode.id}
                    style={[
                      styles.segmentedBtn,
                      settings.toolApprovalMode === mode.id && styles.segmentedBtnActive,
                    ]}
                    onPress={() => updateSettings({ toolApprovalMode: mode.id })}
                  >
                    <Text
                      style={[
                        styles.segmentedBtnText,
                        settings.toolApprovalMode === mode.id && styles.segmentedBtnTextActive,
                      ]}
                    >
                      {mode.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.divider} />

            {/* Default Computer Profile */}
            <View style={styles.colBlock}>
              <View style={styles.rowLead}>
                <Cpu size={18} color={colors.accentCyan} />
                <View>
                  <Text style={styles.rowTitle}>Default Container Sandbox Profile</Text>
                  <Text style={styles.rowSubtitle}>Saved on this phone. Existing computers keep their own profile.</Text>
                </View>
              </View>

              <View style={styles.segmentedRow}>
                {(
                  [
                    { id: "standard", label: "Standard" },
                    { id: "browser", label: "Browser" },
                  ] as const
                ).map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.segmentedBtn,
                      settings.defaultComputerProfile === p.id && styles.segmentedBtnActive,
                    ]}
                    onPress={() => updateSettings({ defaultComputerProfile: p.id })}
                  >
                    <Text
                      style={[
                        styles.segmentedBtnText,
                        settings.defaultComputerProfile === p.id &&
                          styles.segmentedBtnTextActive,
                      ]}
                    >
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.divider} />

            {/* Auto open terminal */}
            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Terminal size={18} color={colors.textSecondary} />
                <View>
                  <Text style={styles.rowTitle}>Auto-Drawer on Command Run</Text>
                  <Text style={styles.rowSubtitle}>Slide up shell logs automatically</Text>
                </View>
              </View>
              <Switch
                value={settings.autoOpenTerminal}
                onValueChange={(val) => {
                  void updateSettings({ autoOpenTerminal: val })
                }}
                trackColor={{ false: colors.surfaceLight, true: colors.primaryDark }}
                thumbColor={settings.autoOpenTerminal ? colors.primaryBright : colors.textMuted}
              />
            </View>
          </View>
        </View>

        {/* ============================================================== */}
        {/* 5. APPEARANCE & INTERFACE                                      */}
        {/* ============================================================== */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Appearance & Interface</Text>
          <View style={styles.card}>
            {/* Theme Style */}
            <View style={styles.colBlock}>
              <View style={styles.rowLead}>
                <Moon size={18} color={colors.accentCyan} />
                <View>
                  <Text style={styles.rowTitle}>Theme Palette</Text>
                  <Text style={styles.rowSubtitle}>Changes the background of the app</Text>
                </View>
              </View>

              <View style={styles.segmentedRow}>
                {(
                  [
                    { id: "dark", label: "Obsidian" },
                    { id: "oled", label: "Midnight OLED" },
                    { id: "emerald", label: "Emerald Cyber" },
                  ] as const
                ).map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.segmentedBtn,
                      settings.themeMode === t.id && styles.segmentedBtnActive,
                    ]}
                    onPress={() => updateSettings({ themeMode: t.id })}
                  >
                    <Text
                      style={[
                        styles.segmentedBtnText,
                        settings.themeMode === t.id && styles.segmentedBtnTextActive,
                      ]}
                    >
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.divider} />

            {/* Font Size */}
            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Sliders size={18} color={colors.textSecondary} />
                <View>
                  <Text style={styles.rowTitle}>Message Font Scale</Text>
                  <Text style={styles.rowSubtitle}>Readability for chat bubbles</Text>
                </View>
              </View>

              <View style={styles.tempChipRow}>
                {(["compact", "normal", "large"] as const).map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.tempChip,
                      settings.fontSize === s && styles.tempChipActive,
                    ]}
                    onPress={() => updateSettings({ fontSize: s })}
                  >
                    <Text
                      style={[
                        styles.tempChipText,
                        settings.fontSize === s && styles.tempChipTextActive,
                      ]}
                    >
                      {s === "compact" ? "Small" : s === "large" ? "Large" : "Norm"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.divider} />

            {/* Haptics */}
            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Zap size={18} color={colors.accentGold} />
                <View>
                  <Text style={styles.rowTitle}>Haptic Feedback</Text>
                  <Text style={styles.rowSubtitle}>Vibrate when you send a message or decide a tool request</Text>
                </View>
              </View>
              <Switch
                value={settings.hapticsEnabled}
                onValueChange={(val) => {
                  void updateSettings({ hapticsEnabled: val })
                }}
                trackColor={{ false: colors.surfaceLight, true: colors.primaryDark }}
                thumbColor={settings.hapticsEnabled ? colors.primaryBright : colors.textMuted}
              />
            </View>

            <View style={styles.divider} />

            {/* Sound */}
            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Volume2 size={18} color={colors.accentCyan} />
                <View>
                  <Text style={styles.rowTitle}>Sound Effects</Text>
                  <Text style={styles.rowSubtitle}>Saved on this phone. This build does not play sounds.</Text>
                </View>
              </View>
              <Switch
                value={settings.soundEffects}
                onValueChange={(val) => {
                  void updateSettings({ soundEffects: val })
                }}
                trackColor={{ false: colors.surfaceLight, true: colors.primaryDark }}
                thumbColor={settings.soundEffects ? colors.primaryBright : colors.textMuted}
              />
            </View>
          </View>
        </View>

        {/* ============================================================== */}
        {/* 6. NOTIFICATIONS & ALERTS                                      */}
        {/* ============================================================== */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Notifications & Alerts</Text>
          <Text style={styles.sectionNote}>
            These switches are saved on this phone. This build does not deliver push alerts.
          </Text>
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Bell size={18} color={colors.primaryBright} />
                <View>
                  <Text style={styles.rowTitle}>Push Notifications</Text>
                  <Text style={styles.rowSubtitle}>Background alerts from autonomous agents</Text>
                </View>
              </View>
              <Switch
                value={settings.pushNotifications}
                onValueChange={(val) => {
                  void updateSettings({ pushNotifications: val })
                }}
                trackColor={{ false: colors.surfaceLight, true: colors.primaryDark }}
                thumbColor={settings.pushNotifications ? colors.primaryBright : colors.textMuted}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Check size={18} color={colors.accentCyan} />
                <View>
                  <Text style={styles.rowTitle}>Task Finished Alerts</Text>
                  <Text style={styles.rowSubtitle}>When 24/7 background queue completes</Text>
                </View>
              </View>
              <Switch
                value={settings.notifyOnTaskComplete}
                onValueChange={(val) => {
                  void updateSettings({ notifyOnTaskComplete: val })
                }}
                trackColor={{ false: colors.surfaceLight, true: colors.primaryDark }}
                thumbColor={settings.notifyOnTaskComplete ? colors.primaryBright : colors.textMuted}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Shield size={18} color={colors.accentWarning} />
                <View>
                  <Text style={styles.rowTitle}>Urgent Tool Approvals</Text>
                  <Text style={styles.rowSubtitle}>Instant notification for dangerous tools</Text>
                </View>
              </View>
              <Switch
                value={settings.notifyOnApproval}
                onValueChange={(val) => {
                  void updateSettings({ notifyOnApproval: val })
                }}
                trackColor={{ false: colors.surfaceLight, true: colors.primaryDark }}
                thumbColor={settings.notifyOnApproval ? colors.primaryBright : colors.textMuted}
              />
            </View>
          </View>
        </View>

        {/* ============================================================== */}
        {/* 7. STORAGE, CACHE & SYSTEM ACTIONS                             */}
        {/* ============================================================== */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Data & Diagnostics</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.rowBetween}
              onPress={handleResetDefaults}
              activeOpacity={0.7}
            >
              <View style={styles.rowLead}>
                <RotateCcwIcon size={18} color={colors.accentWarning} />
                <View>
                  <Text style={styles.rowTitle}>Restore Factory Defaults</Text>
                  <Text style={styles.rowSubtitle}>Reset all keys, endpoints, and preferences</Text>
                </View>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ============================================================== */}
        {/* 8. ABOUT & SIGN OUT                                            */}
        {/* ============================================================== */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>About</Text>
          <View style={styles.card}>
            <View style={styles.aboutRow}>
              <View style={styles.aboutLogo}>
                <Bot size={22} color={colors.primaryBright} />
              </View>
              <View>
                <Text style={styles.aboutTitle}>Sayabot Mobile</Text>
                <Text style={styles.aboutSubtitle}>
                  Version 1.0.0 (Build 42) • Turbo-Workspace Monorepo
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.securityNotice}>
              <Lock size={14} color={colors.accentGold} />
              <Text style={styles.securityNoticeText}>
                End-to-end authenticated. Credentials and model secrets are AES-256-GCM encrypted in
                the workspace vault.
              </Text>
            </View>
          </View>
        </View>

        {/* Sign Out Button */}
        <View style={styles.logoutContainer}>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={handleSignOut}
            activeOpacity={0.8}
          >
            <LogOut size={16} color={colors.accentDanger} />
            <Text style={styles.logoutText}>Sign Out from Workspace</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ============================================================== */}
      {/* MODAL 1: EDIT DISPLAY NAME                                     */}
      {/* ============================================================== */}
      <Modal visible={editNameModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Display Name</Text>
              <TouchableOpacity onPress={() => setEditNameModal(false)}>
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Enter your name"
              placeholderTextColor={colors.textPlaceholder}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditNameModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={async () => {
                  if (nameInput.trim()) {
                    await updateSettings({ displayName: nameInput.trim() })
                  }
                  setEditNameModal(false)
                }}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 2: SWITCH WORKSPACE / ORG SLUG                           */}
      {/* ============================================================== */}
      <Modal visible={editOrgModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Switch Workspace</Text>
              <TouchableOpacity onPress={() => setEditOrgModal(false)}>
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDescription}>
              Enter the organization slug corresponding to your multi-agent workspace in Supabase.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={orgInput}
              onChangeText={setOrgInput}
              placeholder="e.g. default or sayalabs"
              placeholderTextColor={colors.textPlaceholder}
              autoCapitalize="none"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditOrgModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={async () => {
                  if (orgInput.trim()) {
                    await updateSettings({ orgSlug: orgInput.trim().toLowerCase() })
                  }
                  setEditOrgModal(false)
                }}
              >
                <Text style={styles.modalSaveText}>Switch</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 3: BYOK API KEY VAULT                                    */}
      {/* ============================================================== */}
      <Modal visible={apiKeyModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Key size={18} color={colors.accentWarning} />
                <Text style={styles.modalTitle}>BYOK API Key</Text>
              </View>
              <TouchableOpacity onPress={() => setApiKeyModal(false)}>
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              Supply your personal API key for {settings.aiProvider.toUpperCase()}. All agent turns
              will execute against your private key quota.
            </Text>

            <View style={styles.keyInputContainer}>
              <TextInput
                style={styles.keyInput}
                value={apiKeyInput}
                onChangeText={setApiKeyInput}
                placeholder="sk-or-... or private key"
                placeholderTextColor={colors.textPlaceholder}
                secureTextEntry={!showApiKey}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOff size={18} color={colors.textSecondary} />
                ) : (
                  <Eye size={18} color={colors.textSecondary} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              {settings.apiKey ? (
                <TouchableOpacity
                  style={styles.modalDeleteBtn}
                  onPress={async () => {
                    await updateSettings({ apiKey: "" })
                    setApiKeyInput("")
                    setApiKeyModal(false)
                  }}
                >
                  <Text style={styles.modalDeleteText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setApiKeyModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={async () => {
                  await updateSettings({ apiKey: apiKeyInput.trim() })
                  setApiKeyModal(false)
                }}
              >
                <Text style={styles.modalSaveText}>Save Key</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 4: VPS GATEWAY URL                                       */}
      {/* ============================================================== */}
      <Modal visible={editGatewayModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>VPS Gateway Endpoint</Text>
              <TouchableOpacity onPress={() => setEditGatewayModal(false)}>
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              The HTTPS or HTTP endpoint where your Sayabot web server and agent dispatchers run.
            </Text>

            <TextInput
              style={styles.modalInput}
              value={gatewayInput}
              onChangeText={setGatewayInput}
              placeholder="https://your-domain.com or http://10.0.2.2:3000"
              placeholderTextColor={colors.textPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditGatewayModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={async () => {
                  if (gatewayInput.trim()) {
                    await updateSettings({ webApiUrl: gatewayInput.trim() })
                    runDiagnostics(gatewayInput.trim())
                  }
                  setEditGatewayModal(false)
                }}
              >
                <Text style={styles.modalSaveText}>Update</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function RotateCcwIcon({ size = 18, color = "#fff" }: { size?: number; color?: string }) {
  return <RefreshCw size={size} color={color} style={{ transform: [{ scaleX: -1 }] }} />
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
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: 11.5,
    marginTop: 2,
  },
  headerActionBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  scrollContent: {
    padding: 16,
    gap: 18,
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: 11.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingLeft: 4,
  },
  sectionNote: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    paddingLeft: 4,
    paddingRight: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 4,
  },
  activeProviderBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  activeProviderText: {
    color: colors.primaryBright,
    fontSize: 10,
    fontWeight: "700",
  },
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    position: "relative",
  },
  avatarText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
  },
  avatarOnlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primaryBright,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  profileDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  userName: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  pencilBtn: {
    padding: 3,
  },
  userEmail: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 1,
  },
  metaBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(37, 211, 102, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  roleText: {
    color: colors.primaryBright,
    fontSize: 11,
    fontWeight: "600",
  },
  orgBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(83, 189, 235, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  orgText: {
    color: colors.accentCyan,
    fontSize: 11,
    fontWeight: "600",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
  },
  providerPillRow: {
    gap: 6,
    paddingBottom: 4,
  },
  providerPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  providerPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryBright,
  },
  providerPillText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  providerPillTextActive: {
    color: colors.textInverse,
  },
  modelPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  modelPresetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modelPresetChipActive: {
    borderColor: colors.accentPurple,
    backgroundColor: "rgba(168, 85, 247, 0.15)",
  },
  modelPresetText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    fontWeight: "500",
  },
  modelPresetTextActive: {
    color: colors.accentPurple,
    fontWeight: "700",
  },
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  stepperBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stepperText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  stepperValue: {
    color: colors.primaryBright,
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 8,
  },
  tempChipRow: {
    flexDirection: "row",
    gap: 6,
  },
  tempChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  tempChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryBright,
  },
  tempChipText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    fontWeight: "600",
  },
  tempChipTextActive: {
    color: colors.textInverse,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: 12,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  rowTrail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: 14.5,
    fontWeight: "600",
  },
  rowSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  pingStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  pingStatusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  pingOk: {
    backgroundColor: "rgba(37, 211, 102, 0.15)",
  },
  pingBad: {
    backgroundColor: colors.accentDangerBg,
  },
  pingOkText: {
    color: colors.primaryBright,
    fontSize: 11,
    fontWeight: "700",
  },
  pingBadText: {
    color: colors.accentDanger,
    fontSize: 11,
    fontWeight: "700",
  },
  testConnectionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  testConnectionBtnText: {
    color: colors.textInverse,
    fontSize: 13.5,
    fontWeight: "700",
  },
  colBlock: {
    gap: 10,
  },
  segmentedRow: {
    flexDirection: "row",
    backgroundColor: colors.surfaceLight,
    padding: 3,
    borderRadius: 10,
    gap: 4,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentedBtnActive: {
    backgroundColor: colors.primary,
  },
  segmentedBtnText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  segmentedBtnTextActive: {
    color: colors.textInverse,
    fontWeight: "700",
  },
  aboutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  aboutLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  aboutTitle: {
    color: colors.textPrimary,
    fontSize: 15.5,
    fontWeight: "700",
  },
  aboutSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  securityNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 210, 121, 0.08)",
    padding: 10,
    borderRadius: 8,
  },
  securityNoticeText: {
    color: colors.accentGold,
    fontSize: 11.5,
    flex: 1,
    lineHeight: 16,
  },
  logoutContainer: {
    marginTop: 4,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: colors.surface,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accentDangerBg,
  },
  logoutText: {
    color: colors.accentDanger,
    fontSize: 14.5,
    fontWeight: "700",
  },

  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  modalDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  modalInput: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  keyInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 12,
  },
  keyInput: {
    flex: 1,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
    fontFamily: fonts.mono,
  },
  eyeBtn: {
    padding: 6,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  modalDeleteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: "auto",
  },
  modalDeleteText: {
    color: colors.accentDanger,
    fontSize: 14,
    fontWeight: "600",
  },
  modalSaveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
  },
  modalSaveText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "700",
  },
})
