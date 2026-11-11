import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import {
  Bot,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Server,
  Sparkles,
  X,
} from "lucide-react-native"
import { setDemoMode } from "../core/session-mode"
import { supabase } from "../core/supabase"
import { useAuth } from "../hooks/useAuth"
import { useSettings } from "../hooks/useSettings"
import { colors } from "../theme"

interface AuthScreenProps {
  onEnterDemo?: () => void
}

export function AuthScreen({ onEnterDemo }: AuthScreenProps) {
  const { settings, updateSettings } = useSettings()
  const { signInWithOAuth } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Server gateway config modal
  const [serverModal, setServerModal] = useState(false)
  const [serverUrlInput, setServerUrlInput] = useState(settings.webApiUrl)

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
      setErrorMsg(err instanceof Error ? err.message : "OAuth sign-in failed")
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
      setErrorMsg(err instanceof Error ? err.message : "Authentication failed")
    } finally {
      setLoading(false)
    }
  }

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
        <View style={styles.content}>
          {/* Logo Badge */}
          <View style={styles.logoBadge}>
            <Bot size={40} color={colors.textInverse} />
          </View>

          <Text style={styles.title}>Sayabot Mobile</Text>
          <Text style={styles.subtitle}>
            Autonomous AI agents collaborating in real-time rooms with persistent Linux sandboxes.
          </Text>

          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}
          {notice && (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          {/* Form */}
          <View style={styles.form}>
            {/* OAuth Buttons */}
            <View style={styles.oauthContainer}>
              <TouchableOpacity
                style={styles.oauthBtnGoogle}
                onPress={() => handleOAuth("google")}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={styles.oauthBtnGoogleText}>Continue with Google</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.oauthBtnGithub}
                onPress={() => handleOAuth("github")}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={styles.oauthBtnGithubText}>Continue with GitHub</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with email</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.inputContainer}>
              <Mail size={18} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter email address"
                placeholderTextColor={colors.textPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.inputContainer}>
              <Lock size={18} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter password"
                placeholderTextColor={colors.textPlaceholder}
                secureTextEntry={!showPassword}
                autoComplete={isSignUp ? "password-new" : "password"}
                textContentType={isSignUp ? "newPassword" : "password"}
                value={password}
                onChangeText={setPassword}
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
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Text style={styles.submitBtnText}>
                  {isSignUp ? "Agree & Continue" : "Sign In to Workspace"}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setIsSignUp(!isSignUp)
                setErrorMsg(null)
                setNotice(null)
              }}
              style={styles.toggleBtn}
            >
              <Text style={styles.toggleText}>
                {isSignUp
                  ? "Already have an account? Sign In"
                  : "New to workspace? Register account"}
              </Text>
            </TouchableOpacity>

            {/* Demo / Guest Access Button */}
            <TouchableOpacity
              style={styles.demoBtn}
              onPress={handleDemoSignIn}
              activeOpacity={0.8}
            >
              <Sparkles size={14} color={colors.primaryBright} />
              <Text style={styles.demoBtnText}>Look around without an account</Text>
            </TouchableOpacity>
            <Text style={styles.demoHint}>
              Preview only. Rooms, tasks, and messages stay unavailable until you sign in.
            </Text>
          </View>

          {/* Server Endpoint Indicator Pill */}
          <TouchableOpacity
            style={styles.serverPill}
            onPress={() => setServerModal(true)}
            activeOpacity={0.8}
          >
            <Server size={12} color={colors.textSecondary} />
            <Text style={styles.serverPillText} numberOfLines={1}>
              Gateway: {settings.webApiUrl.replace(/^https?:\/\//, "")}
            </Text>
            <ChevronRight size={12} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Server Endpoint Modal */}
      <Modal visible={serverModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Configure API Gateway</Text>
              <TouchableOpacity onPress={() => setServerModal(false)}>
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Change the VPS endpoint address if you are hosting Sayabot on a private server or
              local network.
            </Text>

            <TextInput
              style={styles.modalInput}
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              placeholder="https://your-domain.com"
              placeholderTextColor={colors.textPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setServerModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={async () => {
                  const next = serverUrlInput.trim().replace(/\/+$/, "")
                  if (!/^https?:\/\//i.test(next)) {
                    setErrorMsg("The gateway address needs to start with http:// or https://")
                    setServerModal(false)
                    return
                  }
                  await updateSettings({ webApiUrl: next })
                  setServerModal(false)
                }}
              >
                <Text style={styles.modalSaveText}>Save Endpoint</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 28,
    alignItems: "center",
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13.5,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 19,
    maxWidth: 310,
  },
  errorBox: {
    backgroundColor: colors.accentDangerBg,
    padding: 10,
    borderRadius: 8,
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
    borderRadius: 8,
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
  form: {
    width: "100%",
    gap: 12,
  },
  oauthContainer: {
    gap: 10,
    marginBottom: 6,
  },
  oauthBtnGoogle: {
    backgroundColor: "#ffffff",
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  oauthBtnGoogleText: {
    color: "#000000",
    fontSize: 14.5,
    fontWeight: "700",
  },
  oauthBtnGithub: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  oauthBtnGithubText: {
    color: colors.textPrimary,
    fontSize: 14.5,
    fontWeight: "600",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderSubtle,
  },
  dividerText: {
    color: colors.textSecondary,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
    marginTop: 6,
    height: 50,
    backgroundColor: colors.primary,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  submitBtnText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: "700",
  },
  toggleBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  toggleText: {
    color: colors.accentCyan,
    fontSize: 13,
    fontWeight: "600",
  },
  demoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surfaceLight,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: 4,
  },
  demoBtnText: {
    color: colors.primaryBright,
    fontSize: 13.5,
    fontWeight: "600",
  },
  demoHint: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
  serverPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 24,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  serverPillText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    maxWidth: 220,
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
