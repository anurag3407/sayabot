import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { ChevronRight, Eye, EyeOff, Lock, Mail, QrCode, Server, X } from "lucide-react-native"
import { PairScanner } from "../components/PairScanner"
import type { PairLink } from "../core/pair-link"
import { setDemoMode } from "../core/session-mode"
import { checkServer, useCloud, useServer } from "../core/server"
import { loadSavedServer, supabase } from "../core/supabase"
import { useAuth } from "../hooks/useAuth"
import { useSettings } from "../hooks/useSettings"
import { colors } from "../theme"
import markImage from "../../assets/mark.png"

interface AuthScreenProps {
  onEnterDemo?: () => void
}

export function AuthScreen({ onEnterDemo }: AuthScreenProps) {
  const { settings, updateSettings } = useSettings()
  const { signInWithOAuth, signInWithCode, pairError } = useAuth()
  const [codeModal, setCodeModal] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [codeInput, setCodeInput] = useState("")
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const submitCode = async () => {
    setCodeBusy(true)
    setCodeError(null)
    try {
      await signInWithCode(codeInput)
      setCodeModal(false)
      setCodeInput("")
    } catch (err: unknown) {
      setCodeError(err instanceof Error ? err.message : "Could not sign in with that code")
    } finally {
      setCodeBusy(false)
    }
  }

  const submitScan = async (link: PairLink) => {
    setCodeBusy(true)
    setScanError(null)
    try {
      await signInWithCode(link.code, link.server)
      setScanOpen(false)
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Could not sign in with that code")
    } finally {
      setCodeBusy(false)
    }
  }
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const passwordRef = useRef<TextInput>(null)
  // The footer would sit on top of the keyboard and cover the password field, so hide it.
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true))
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Server gateway config modal
  const [serverModal, setServerModal] = useState(false)
  const [serverUrlInput, setServerUrlInput] = useState(settings.webApiUrl)
  // "Choose your server": the address is checked as it's typed, then the app restarts into it.
  const [serverName, setServerName] = useState<string | null>(null)
  const [serverCheck, setServerCheck] = useState<{
    tone: "ok" | "error" | "busy"
    text: string
  } | null>(null)
  const [serverBusy, setServerBusy] = useState(false)

  useEffect(() => {
    void loadSavedServer().then((saved) => setServerName(saved?.name ?? null))
  }, [])

  useEffect(() => {
    if (!serverModal) return
    const value = serverUrlInput.trim()
    if (!value || value.replace(/\/+$/, "") === settings.webApiUrl) {
      setServerCheck(null)
      return
    }
    setServerCheck({ tone: "busy", text: "Checking…" })
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await checkServer(value)
      if (cancelled) return
      setServerCheck(
        result.ok
          ? { tone: "ok", text: `✓ Found ${result.server.name}` }
          : { tone: "error", text: result.error },
      )
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [serverUrlInput, serverModal, settings.webApiUrl])

  /** "Couldn't reach Acme's Sayabot…" instead of a bare "Network request failed". */
  const friendlyAuthError = (err: unknown, fallback: string): string => {
    const message = err instanceof Error ? err.message : fallback
    if (/network request failed|failed to fetch|network error|timed? ?out/i.test(message)) {
      return `Couldn't reach ${serverName ?? "Sayabot Cloud"}. Check your connection and try again.`
    }
    return message
  }

  // On Sayabot Cloud the field starts empty (nobody types the Cloud address); on your own
  // server it shows the current address so it's easy to correct.
  const openServerSheet = () => {
    setServerUrlInput(serverName ? settings.webApiUrl : "")
    setServerCheck(null)
    setServerModal(true)
  }

  const connectServer = async () => {
    setServerBusy(true)
    const result = await checkServer(serverUrlInput)
    if (!result.ok) {
      setServerBusy(false)
      setServerCheck({ tone: "error", text: result.error })
      return
    }
    setServerCheck({ tone: "ok", text: `Connecting to ${result.server.name}…` })
    await useServer(result.server)
  }

  useEffect(() => {
    setServerUrlInput(settings.webApiUrl)
  }, [settings.webApiUrl])

  const handleOAuth = async (provider: "google" | "github") => {
    setLoading(true)
    setErrorMsg(null)
    setNotice(null)
    try {
      await signInWithOAuth(provider)
    } catch (err: unknown) {
      setErrorMsg(friendlyAuthError(err, "OAuth sign-in failed"))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setErrorMsg("Enter both an email and a password.")
      return
    }
    if (isSignUp && password.length < 6) {
      setErrorMsg("Use at least 6 characters for the password.")
      return
    }

    setLoading(true)
    setErrorMsg(null)
    setNotice(null)

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })
        if (error) throw error
        if (!data.session) {
          setNotice("Check your email to confirm this account, then sign in.")
          setIsSignUp(false)
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw error
      }
    } catch (err: unknown) {
      setErrorMsg(friendlyAuthError(err, "Authentication failed"))
    } finally {
      setLoading(false)
    }
  }

  const serverLabel =
    serverName ??
    (settings.webApiUrl === "https://sayabot.sayalabs.in"
      ? "Sayabot Cloud"
      : settings.webApiUrl.replace(/^https?:\/\//, ""))

  const handleDemoSignIn = async () => {
    setLoading(true)
    setErrorMsg(null)
    setNotice(null)
    try {
      await updateSettings({
        displayName: "Guest",
        role: "Preview",
      })
      if (onEnterDemo) {
        onEnterDemo()
      } else {
        setDemoMode(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        {/* Scrolls when the content is taller than the screen (small phones, an error banner,
            the keyboard), so the server switch at the bottom is always reachable. */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <View style={styles.hero}>
              <Image source={markImage} style={styles.logoMark} accessibilityIgnoresInvertColors />
              <Text style={styles.title}>Sayabot</Text>
              <Text style={styles.subtitle}>Your agents, on your phone.</Text>
            </View>

            {(errorMsg || pairError) && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg || pairError}</Text>
              </View>
            )}
            {notice && (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}

            <View style={styles.form}>
              {/* Fastest path: a one-time code from "Add a phone" on a computer that's signed in. */}
              <TouchableOpacity
                style={styles.codeBtn}
                onPress={() => {
                  setScanError(null)
                  setScanOpen(true)
                }}
                disabled={loading}
                activeOpacity={0.85}
              >
                <QrCode size={18} color={colors.textInverse} />
                <Text style={styles.codeBtnText}>Scan the QR code</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setCodeError(null)
                  setCodeModal(true)
                }}
                disabled={loading}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>Type the code instead</Text>
              </TouchableOpacity>
              <Text style={styles.codeHint}>On your computer: Settings → Phones → Add phone</Text>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.oauthRow}>
                <TouchableOpacity
                  style={styles.oauthBtn}
                  onPress={() => handleOAuth("google")}
                  disabled={loading}
                  activeOpacity={0.85}
                  accessibilityLabel="Continue with Google"
                >
                  <Text style={styles.oauthBtnText}>Google</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.oauthBtn}
                  onPress={() => handleOAuth("github")}
                  disabled={loading}
                  activeOpacity={0.85}
                  accessibilityLabel="Continue with GitHub"
                >
                  <Text style={styles.oauthBtnText}>GitHub</Text>
                </TouchableOpacity>
              </View>

              {/* Email stays folded away until asked for, so the first screen has three choices. */}
              {showEmail ? (
                <View style={styles.emailForm}>
                  <View style={styles.inputContainer}>
                    <Mail size={18} color={colors.textSecondary} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Email"
                      placeholderTextColor={colors.textPlaceholder}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      textContentType="emailAddress"
                      autoFocus
                      value={email}
                      onChangeText={setEmail}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => passwordRef.current?.focus()}
                    />
                  </View>

                  <View style={styles.inputContainer}>
                    <Lock size={18} color={colors.textSecondary} style={styles.inputIcon} />
                    <TextInput
                      ref={passwordRef}
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor={colors.textPlaceholder}
                      secureTextEntry={!showPassword}
                      autoComplete={isSignUp ? "password-new" : "password"}
                      textContentType={isSignUp ? "newPassword" : "password"}
                      value={password}
                      onChangeText={setPassword}
                      returnKeyType="go"
                      onSubmitEditing={handleSubmit}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.eyeBtn}
                      accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeOff size={18} color={colors.textSecondary} />
                      ) : (
                        <Eye size={18} color={colors.textSecondary} />
                      )}
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={styles.submitBtn}
                    onPress={handleSubmit}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color={colors.textPrimary} />
                    ) : (
                      <Text style={styles.submitBtnText}>
                        {isSignUp ? "Create account" : "Sign in"}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setIsSignUp(!isSignUp)
                      setErrorMsg(null)
                      setNotice(null)
                    }}
                    style={styles.linkBtn}
                  >
                    <Text style={styles.linkText}>
                      {isSignUp ? "Have an account? Sign in" : "New here? Create an account"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setShowEmail(true)} style={styles.linkBtn}>
                  <Text style={styles.linkText}>Use email instead</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>

        {/* Quiet footer: where you're signing in, and a way to peek without an account. */}
        {keyboardOpen ? null : (
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.footerBtn}
              onPress={openServerSheet}
              activeOpacity={0.7}
              accessibilityLabel="Change server"
            >
              <Server size={12} color={colors.textSecondary} />
              <Text style={styles.footerText} numberOfLines={1}>
                {serverLabel}
              </Text>
              <ChevronRight size={12} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.footerDot}>·</Text>
            <TouchableOpacity
              style={styles.footerBtn}
              onPress={handleDemoSignIn}
              disabled={loading}
              activeOpacity={0.7}
              accessibilityHint="Preview only. Rooms, tasks and messages need an account."
            >
              <Text style={styles.footerText}>Just looking</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      <PairScanner
        visible={scanOpen}
        busy={codeBusy}
        error={scanError}
        onClose={() => setScanOpen(false)}
        onScan={(link) => void submitScan(link)}
        onTypeInstead={() => {
          setScanOpen(false)
          setCodeError(null)
          setCodeModal(true)
        }}
      />

      {/* One-time code modal */}
      <Modal
        visible={codeModal}
        animationType="slide"
        transparent
        onRequestClose={() => setCodeModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sign in with a code</Text>
              <TouchableOpacity onPress={() => setCodeModal(false)} accessibilityLabel="Close">
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDesc}>
              On your computer, open Sayabot → Settings → Phones → Add phone → Yes, sign in. Type
              the code it shows.
            </Text>
            <TextInput
              style={[styles.modalInput, styles.codeInput]}
              value={codeInput}
              onChangeText={(text) => setCodeInput(text.toUpperCase())}
              placeholder="ABCD-2345"
              placeholderTextColor={colors.textPlaceholder}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              maxLength={12}
              returnKeyType="go"
              onSubmitEditing={submitCode}
            />
            {codeError ? <Text style={styles.errorText}>{codeError}</Text> : null}
            <Text style={styles.codeServer}>Server: {settings.webApiUrl}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setCodeModal(false)
                  openServerSheet()
                }}
              >
                <Text style={styles.modalCancelText}>Change server</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={submitCode}
                disabled={codeBusy}
              >
                {codeBusy ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.modalSaveText}>Sign in</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={serverModal}
        animationType="fade"
        transparent
        onRequestClose={() => setServerModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose your server</Text>
              <TouchableOpacity onPress={() => setServerModal(false)} accessibilityLabel="Close">
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Now using {serverName ?? "Sayabot Cloud"}. To use a Sayabot that you or your team
              host, enter its address. You sign in on that server, and your data stays there.
            </Text>

            <TextInput
              style={styles.modalInput}
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              placeholder="sayabot.yourcompany.com"
              placeholderTextColor={colors.textPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={connectServer}
              accessibilityLabel="Server address"
            />
            {serverCheck ? (
              <Text
                style={[
                  styles.serverCheckText,
                  serverCheck.tone === "ok"
                    ? styles.serverCheckOk
                    : serverCheck.tone === "error"
                      ? styles.errorText
                      : null,
                ]}
                accessibilityLiveRegion="polite"
              >
                {serverCheck.text}
              </Text>
            ) : null}

            <View style={styles.modalActions}>
              {serverName ? (
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => void useCloud()}
                  disabled={serverBusy}
                >
                  <Text style={styles.modalCancelText}>Use Sayabot Cloud</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setServerModal(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={connectServer}
                disabled={serverBusy}
              >
                {serverBusy ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.modalSaveText}>Connect</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 32,
  },
  content: {
    paddingHorizontal: 28,
    alignItems: "center",
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  hero: {
    alignItems: "center",
    marginBottom: 36,
  },
  logoMark: {
    width: 64,
    height: 64,
    marginBottom: 16,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    marginTop: 6,
  },
  errorBox: {
    backgroundColor: colors.accentDangerBg,
    padding: 10,
    borderRadius: 10,
    marginBottom: 16,
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(241, 92, 109, 0.3)",
  },
  errorText: {
    color: colors.accentDanger,
    fontSize: 13,
    textAlign: "center",
  },
  noticeBox: {
    backgroundColor: "rgba(83, 189, 235, 0.12)",
    padding: 10,
    borderRadius: 10,
    marginBottom: 16,
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(83, 189, 235, 0.35)",
  },
  noticeText: {
    color: colors.accentCyan,
    fontSize: 13,
    textAlign: "center",
  },
  serverCheckText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
  },
  serverCheckOk: {
    color: colors.accentCyan,
  },
  form: {
    width: "100%",
  },
  codeBtn: {
    flexDirection: "row",
    gap: 10,
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  codeBtnText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: "700",
  },
  codeHint: {
    color: colors.textSecondary,
    fontSize: 12.5,
    textAlign: "center",
    marginTop: 10,
  },
  codeInput: {
    fontSize: 26,
    letterSpacing: 4,
    textAlign: "center",
    fontWeight: "700",
  },
  codeServer: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 8,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  oauthRow: {
    flexDirection: "row",
    gap: 12,
  },
  oauthBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  oauthBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  emailForm: {
    gap: 12,
    marginTop: 16,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
  },
  eyeBtn: {
    padding: 6,
  },
  submitBtn: {
    height: 50,
    backgroundColor: colors.surfaceLight,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  submitBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  linkBtn: {
    paddingVertical: 14,
    alignItems: "center",
  },
  linkText: {
    color: colors.accentCyan,
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  footerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 12.5,
    maxWidth: 190,
  },
  footerDot: {
    color: colors.textSecondary,
    fontSize: 12.5,
    marginHorizontal: 4,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  modalDesc: {
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
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
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
  modalSaveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalSaveText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "700",
  },
})
