import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { MessageBubble, type ChatMessageVM } from "../components/MessageBubble";
import { LiveBuildTaskList } from "../components/LiveBuildTaskList";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api, streamChatMessage, ApiError } from "../lib/api";
import { uploadAttachment, type UploadedAttachment } from "../lib/attachments";
import { transcribeVoiceMemo } from "../lib/voice";
import { Alert } from "../lib/alert";
import { FlatList } from "react-native";

const MAX_PROJECT_VIDEO_MS = 30_000;

interface ChatSessionVM {
  id: string;
}

interface ProjectFileVM {
  id: string;
  path: string;
  content: string;
  language: string | null;
  updatedAt: string;
}

/**
 * Real project workspace: same streaming chat mechanics as ChatScreen, but
 * scoped to one Project (server/src/routes/projects.ts) — the model answers
 * in "build_project" mode (real code, one direct answer — see
 * shared/src/nexaPersona.ts's CODE_BUILD_FORMAT) and every session here is
 * tied to this project's real, persisted history.
 */
export function ProjectChatScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { projectId, projectTitle } = route.params as { projectId: string; projectTitle: string };

  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessageVM[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [files, setFiles] = useState<ProjectFileVM[]>([]);
  const [filesModalOpen, setFilesModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [renamingFile, setRenamingFile] = useState<ProjectFileVM | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Real voice dictation into the composer — the same expo-av recording
  // pipeline as ChatScreen (start/pause/resume/cancel/stop -> real Whisper
  // transcription), just scoped to this Project's build composer.
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  const refreshFiles = useCallback(async () => {
    const { files: rows } = await api<{ files: ProjectFileVM[] }>(`/api/projects/${projectId}/files`);
    setFiles(rows);
  }, [projectId]);

  useEffect(() => {
    navigation.setOptions({
      title: projectTitle,
      headerRight: () => (
        <TouchableOpacity
          onPress={() => {
            refreshFiles();
            setFilesModalOpen(true);
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8 }}
        >
          <Ionicons name="folder-outline" size={18} color={palette.textSecondary} />
          {files.length > 0 && <Text style={{ color: palette.textSecondary, fontSize: 13 }}>{files.length}</Text>}
        </TouchableOpacity>
      ),
    });
  }, [navigation, projectTitle, files.length, refreshFiles, palette.textSecondary]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const openRename = (file: ProjectFileVM) => {
    setRenamingFile(file);
    setRenameInput(file.path);
  };

  const submitRename = async () => {
    if (!renamingFile || !renameInput.trim()) return;
    setRenaming(true);
    try {
      await api(`/api/projects/${projectId}/files/${renamingFile.id}`, { method: "PATCH", body: JSON.stringify({ path: renameInput.trim() }) });
      setRenamingFile(null);
      await refreshFiles();
    } catch (err) {
      Alert.alert("Couldn't rename", err instanceof ApiError ? err.message : "That name might already be taken.");
    } finally {
      setRenaming(false);
    }
  };

  const exportToSiteSpark = async () => {
    setExporting(true);
    try {
      const result = await api<{ siteId: string; url: string; fileCount: number }>(`/api/projects/${projectId}/export/sitespark`, { method: "POST" });
      Alert.alert("Exported to SiteSpark", `${result.fileCount} file${result.fileCount === 1 ? "" : "s"} pushed. Open the live site?`, [
        { text: "Not now", style: "cancel" },
        { text: "Open", onPress: () => Linking.openURL(result.url).catch(() => {}) },
      ]);
    } catch (err) {
      Alert.alert("Couldn't export", err instanceof ApiError ? err.message : "Something went wrong reaching SiteSpark.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const { sessions } = await api<{ sessions: ChatSessionVM[] }>(`/api/projects/${projectId}/sessions`);
        const latest = sessions[0];
        if (latest) {
          setSessionId(latest.id);
          const { messages: history } = await api<{ messages: ChatMessageVM[] }>(`/api/chat/sessions/${latest.id}/messages`);
          setMessages(history);
        }
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, [projectId]);

  const send = useCallback(
    async (text: string, attachment?: UploadedAttachment) => {
      if ((!text.trim() && !attachment) || sending) return;
      const now = Date.now();

      setMessages((prev) => [...prev, { id: `local-${now}`, role: "user", content: text, attachment }]);
      setInput("");
      setSending(true);

      const assistantId = `stream-${now}`;
      setStreamingMessageId(assistantId);
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      await streamChatMessage(
        { sessionId, projectId: sessionId ? undefined : projectId, text, kind: attachment ? "file_attachment" : "text", attachment },
        {
          onDelta: (delta) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
          },
          onDone: (final) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...final.message } : m)));
            setStreamingMessageId(null);
            setSessionId(final.sessionId);
            setSending(false);
            refreshFiles(); // a build_project reply may have just added/changed real project files
          },
          onError: () => {
            setSending(false);
            setStreamingMessageId(null);
            setMessages((prev) => [...prev, { id: `err-${now}`, role: "assistant", content: "Something went wrong reaching NexaAi. Try again in a moment." }]);
          },
        },
      );
    },
    [sessionId, sending, projectId, refreshFiles],
  );

  const startRecording = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    setRecordingSeconds(0);
    setRecordingLevel(0);
    setRecordingPaused(false);
    const { recording: rec } = await Audio.Recording.createAsync(
      { ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true },
      (status) => {
        if (!status.isRecording) return;
        setRecordingSeconds(Math.floor(status.durationMillis / 1000));
        if (typeof status.metering === "number") setRecordingLevel(Math.max(0, Math.min(1, (status.metering + 60) / 60)));
      },
      100,
    );
    setRecording(rec);
  };

  const togglePauseRecording = async () => {
    if (!recording) return;
    if (recordingPaused) {
      await recording.startAsync();
      setRecordingPaused(false);
    } else {
      await recording.pauseAsync();
      setRecordingPaused(true);
    }
  };

  const cancelRecording = async () => {
    if (!recording) return;
    const uri = recording.getURI();
    await recording.stopAndUnloadAsync();
    setRecording(null);
    setRecordingSeconds(0);
    setRecordingLevel(0);
    setRecordingPaused(false);
    if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  };

  const stopRecording = async () => {
    if (!recording) return;
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    setRecordingSeconds(0);
    setRecordingLevel(0);
    setRecordingPaused(false);
    if (!uri) return;
    setTranscribing(true);
    try {
      const transcript = await transcribeVoiceMemo(uri);
      setInput(transcript); // pre-filled so the user can edit before sending, same as ChatScreen
    } catch (err) {
      Alert.alert("Couldn't transcribe", err instanceof ApiError ? err.message : "Couldn't reach the transcription service — try again.");
    } finally {
      setTranscribing(false);
    }
  };

  const handlePickedMedia = async (uri: string, filename: string, mimeType: string) => {
    setUploading(true);
    try {
      const uploaded = await uploadAttachment(uri, filename, mimeType);
      const caption = input.trim() || filename;
      setInput("");
      await send(caption, uploaded);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof ApiError ? err.message : "Couldn't upload that file. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const pickPhoto = async () => {
    setAttachMenuOpen(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await handlePickedMedia(asset.uri, asset.fileName ?? `photo-${Date.now()}`, asset.mimeType ?? "image/jpeg");
  };

  const pickVideo = async () => {
    setAttachMenuOpen(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.8 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    // videoMaxDuration only constrains the camera, not a library pick — so
    // a real, honest cap here means checking the actual returned duration
    // and refusing anything over it, not silently ignoring the "up to 30s" promise.
    if (asset.duration && asset.duration > MAX_PROJECT_VIDEO_MS) {
      Alert.alert("Video too long", "Videos must be 30 seconds or shorter here — pick a shorter clip.");
      return;
    }
    await handlePickedMedia(asset.uri, asset.fileName ?? `video-${Date.now()}`, asset.mimeType ?? "video/mp4");
  };

  return (
    <GalaxyBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <BotAvatar size={32} mood={sending ? "thinking" : "idle"} />
          <Text style={styles.headerTitle}>{projectTitle}</Text>
        </View>

        {loadingHistory ? (
          <ActivityIndicator style={styles.loading} color={palette.accentBright} />
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.emptyText}>Describe what you want to build — e.g. "a one-page portfolio site with a contact form".</Text>
            }
            renderItem={({ item, index }) => (
              <>
                {item.id === streamingMessageId && <LiveBuildTaskList streamingText={item.content} />}
                <MessageBubble message={item} isStreaming={item.id === streamingMessageId} showSeparatorAbove={index > 0 && item.role === "user"} />
              </>
            )}
          />
        )}

        {recording ? (
          <View style={styles.recordingRow} testID="project-recording-row">
            <TouchableOpacity testID="project-recording-cancel" style={styles.recordingIconButton} onPress={cancelRecording}>
              <Ionicons name="trash-outline" size={18} color={palette.danger} />
            </TouchableOpacity>
            <TouchableOpacity testID="project-recording-pause" style={styles.recordingIconButton} onPress={togglePauseRecording}>
              <Ionicons name={recordingPaused ? "play" : "pause"} size={16} color={palette.textPrimary} />
            </TouchableOpacity>
            {!recordingPaused && <View style={styles.recordingDot} />}
            <Text style={styles.recordingTimer}>
              {formatRecordingTime(recordingSeconds)}
              {recordingPaused ? " · Paused" : ""}
            </Text>
            <View style={styles.recordingLevelTrack}>
              <View style={[styles.recordingLevelFill, { width: `${Math.round(recordingLevel * 100)}%`, backgroundColor: palette.accentBright }]} />
            </View>
            <TouchableOpacity
              testID="project-recording-confirm"
              style={[styles.recordingIconButton, { backgroundColor: palette.accent }]}
              onPress={stopRecording}
            >
              <Ionicons name="checkmark" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : transcribing || uploading ? (
          <View style={styles.recordingRow}>
            <ActivityIndicator size="small" color={palette.accentBright} />
            <Text style={styles.recordingTimer}>{transcribing ? "Transcribing your voice memo…" : "Uploading…"}</Text>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TouchableOpacity testID="project-attach-button" style={styles.roundIconButton} onPress={() => setAttachMenuOpen(true)}>
              <Ionicons name="add" size={20} color={palette.textSecondary} />
            </TouchableOpacity>
            <TextInput
              testID="project-input"
              style={styles.input}
              placeholder="Describe what to build or change…"
              placeholderTextColor={palette.textMuted}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => send(input)}
              multiline
            />
            <TouchableOpacity testID="project-mic-button" style={styles.roundIconButton} onPress={startRecording}>
              <Ionicons name="mic-outline" size={19} color={palette.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity testID="project-send-button" style={[styles.sendButton, { backgroundColor: palette.accent }]} onPress={() => send(input)} disabled={sending}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={attachMenuOpen} transparent animationType="fade" onRequestClose={() => setAttachMenuOpen(false)}>
        <TouchableOpacity style={styles.attachOverlay} activeOpacity={1} onPress={() => setAttachMenuOpen(false)}>
          <View style={styles.attachSheet}>
            <TouchableOpacity testID="project-attach-photo" style={styles.attachOption} onPress={pickPhoto}>
              <Ionicons name="image-outline" size={20} color={palette.accentBright} />
              <Text style={styles.attachOptionText}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="project-attach-video" style={styles.attachOption} onPress={pickVideo}>
              <Ionicons name="videocam-outline" size={20} color={palette.accentBright} />
              <View>
                <Text style={styles.attachOptionText}>Video</Text>
                <Text style={styles.attachOptionSubtext}>Up to 30 seconds</Text>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={filesModalOpen} animationType="slide" onRequestClose={() => setFilesModalOpen(false)}>
        <GalaxyBackground>
          <View style={styles.filesHeader}>
            <Text style={styles.filesTitle}>Project files</Text>
            <TouchableOpacity onPress={() => setFilesModalOpen(false)}>
              <Ionicons name="close" size={22} color={palette.textPrimary} />
            </TouchableOpacity>
          </View>

          {files.length === 0 ? (
            <Text style={styles.emptyText}>Nothing built yet — ask NexaAi to build something and real files will show up here.</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.filesList}>
              {files.map((f) => (
                <View key={f.id} style={styles.fileRow}>
                  <Ionicons name="document-text-outline" size={16} color={palette.textSecondary} />
                  <View style={styles.fileRowText}>
                    <Text style={styles.filePath}>{f.path}</Text>
                    <Text style={styles.fileMeta}>{f.language ?? "text"} · {f.content.length.toLocaleString()} chars</Text>
                  </View>
                  <TouchableOpacity onPress={() => openRename(f)} style={styles.renameButton}>
                    <Ionicons name="pencil-outline" size={16} color={palette.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity
            style={[styles.exportButton, { backgroundColor: files.length ? palette.accent : palette.bgCardAlt }]}
            onPress={exportToSiteSpark}
            disabled={!files.length || exporting}
          >
            {exporting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="rocket-outline" size={18} color={files.length ? "#fff" : palette.textMuted} />
                <Text style={[styles.exportButtonText, { color: files.length ? "#fff" : palette.textMuted }]}>Export to SiteSpark</Text>
              </>
            )}
          </TouchableOpacity>
        </GalaxyBackground>
      </Modal>

      <Modal visible={!!renamingFile} transparent animationType="fade" onRequestClose={() => setRenamingFile(null)}>
        <View style={styles.renameOverlay}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Rename file</Text>
            <TextInput
              testID="rename-file-input"
              style={styles.renameInput}
              value={renameInput}
              onChangeText={setRenameInput}
              autoFocus
              autoCapitalize="none"
              onSubmitEditing={submitRename}
            />
            <View style={styles.renameButtons}>
              <TouchableOpacity style={styles.renameCancelButton} onPress={() => setRenamingFile(null)}>
                <Text style={styles.renameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.renameSaveButton, { backgroundColor: palette.accent }]}
                onPress={submitRename}
                disabled={renaming || !renameInput.trim()}
              >
                {renaming ? <ActivityIndicator color="#fff" /> : <Text style={styles.renameSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </GalaxyBackground>
  );
}

/** mm:ss for the live recording timer — recordingSeconds is a real elapsed count from expo-av's own status callback, not a display trick. */
function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    flex: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
    headerTitle: { ...typography.h2, color: palette.textPrimary },
    loading: { marginTop: spacing.lg },
    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
    emptyText: { ...typography.body, color: palette.textMuted, textAlign: "center", marginTop: spacing.lg, paddingHorizontal: spacing.lg },
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md },
    input: {
      flex: 1,
      backgroundColor: palette.bgCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      color: palette.textPrimary,
      maxHeight: 120,
      ...typography.body,
    },
    sendButton: { width: 40, height: 40, borderRadius: radii.pill, alignItems: "center", justifyContent: "center" },
    roundIconButton: {
      width: 38,
      height: 38,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.bgCard,
      borderWidth: 1,
      borderColor: palette.border,
    },
    recordingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md + 4, paddingVertical: spacing.sm },
    recordingIconButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: palette.bgCardAlt },
    recordingDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.danger },
    recordingTimer: { ...typography.bodyBold, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
    recordingLevelTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.bgCardAlt, overflow: "hidden" },
    recordingLevelFill: { height: "100%", borderRadius: 3 },
    attachOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    attachSheet: { backgroundColor: palette.bgCard, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, gap: spacing.sm },
    attachOption: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
    attachOptionText: { ...typography.bodyBold, color: palette.textPrimary },
    attachOptionSubtext: { ...typography.caption, color: palette.textMuted, marginTop: 1 },

    filesHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    filesTitle: { ...typography.h2, color: palette.textPrimary },
    filesList: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.lg },
    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.bgCard,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
    },
    fileRowText: { flex: 1 },
    filePath: { ...typography.bodyBold, color: palette.textPrimary },
    fileMeta: { ...typography.caption, color: palette.textMuted, marginTop: 1 },
    exportButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      borderRadius: radii.md,
      padding: spacing.md,
      margin: spacing.lg,
    },
    exportButtonText: { ...typography.bodyBold },
    renameButton: { padding: 6 },
    renameOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
    renameCard: { width: "100%", maxWidth: 360, backgroundColor: palette.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, gap: spacing.sm },
    renameTitle: { ...typography.h2, fontSize: 18, color: palette.textPrimary },
    renameInput: { backgroundColor: palette.bgCardAlt, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, padding: spacing.md, color: palette.textPrimary, ...typography.body },
    renameButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
    renameCancelButton: { flex: 1, backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
    renameCancelText: { ...typography.bodyBold, color: palette.textSecondary },
    renameSaveButton: { flex: 1, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
    renameSaveText: { ...typography.bodyBold, color: "#fff" },
  });
}
