import React from "react";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../lib/AuthContext";
import { useTheme } from "../lib/ThemeContext";

import { AuthScreen } from "../screens/AuthScreen";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { ChatScreen } from "../screens/ChatScreen";
import { CameraAskScreen } from "../screens/CameraAskScreen";
import { VoiceChatScreen } from "../screens/VoiceChatScreen";
import { PlansScreen } from "../screens/PlansScreen";
import { CreditsScreen } from "../screens/CreditsScreen";
import { AgentBuilderScreen } from "../screens/AgentBuilderScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { AppearanceScreen } from "../screens/AppearanceScreen";
import { PermissionsScreen } from "../screens/PermissionsScreen";
import { CapabilitiesScreen } from "../screens/CapabilitiesScreen";
import { MemoryFilesScreen } from "../screens/MemoryFilesScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { ConnectorsScreen } from "../screens/ConnectorsScreen";
import { ProjectsScreen } from "../screens/ProjectsScreen";
import { ProjectChatScreen } from "../screens/ProjectChatScreen";
import { CallScreen } from "../screens/CallScreen";
import { HelpSupportScreen } from "../screens/HelpSupportScreen";
import { SupportChatScreen } from "../screens/SupportChatScreen";

const RootStack = createNativeStackNavigator();
const HomeStack = createNativeStackNavigator();

// No bottom tab bar — every one of these (previously tabs) is reachable from
// the Chat screen's sidebar drawer (components/ChatSideMenu.tsx) instead,
// which frees the full width at the bottom of the screen for just the
// message input. This is a permanent navigation shape for the app: do not
// reintroduce a bottom tab bar here.
function HomeFlow() {
  const { palette } = useTheme();
  const headerOptions = {
    headerStyle: { backgroundColor: palette.bg },
    headerTitleStyle: { color: palette.textPrimary },
    headerTintColor: palette.accentBright,
  };
  return (
    <HomeStack.Navigator>
      <HomeStack.Screen name="Chat" component={ChatScreen} options={{ headerShown: false }} />
      <HomeStack.Screen name="Camera" component={CameraAskScreen} options={{ ...headerOptions, title: "Ask with camera" }} />
      <HomeStack.Screen name="Voice" component={VoiceChatScreen} options={{ ...headerOptions, title: "Voice chat" }} />
      <HomeStack.Screen name="Projects" component={ProjectsScreen} options={headerOptions} />
      {/* Plans owns its own header — a light, Claude-style upgrade sheet with its own close button, not the app's usual dark header bar. */}
      <HomeStack.Screen name="Plans" component={PlansScreen} options={{ headerShown: false }} />
      <HomeStack.Screen name="Credits" component={CreditsScreen} options={headerOptions} />
      <HomeStack.Screen name="Agents" component={AgentBuilderScreen} options={{ ...headerOptions, title: "My agents" }} />
      <HomeStack.Screen name="Settings" component={SettingsScreen} options={headerOptions} />
      <HomeStack.Screen name="Appearance" component={AppearanceScreen} options={headerOptions} />
      <HomeStack.Screen name="Permissions" component={PermissionsScreen} options={headerOptions} />
      <HomeStack.Screen name="Capabilities" component={CapabilitiesScreen} options={headerOptions} />
      <HomeStack.Screen name="MemoryFiles" component={MemoryFilesScreen} options={{ ...headerOptions, title: "Memory files" }} />
      <HomeStack.Screen name="History" component={HistoryScreen} options={{ ...headerOptions, title: "History" }} />
      <HomeStack.Screen name="Connectors" component={ConnectorsScreen} options={headerOptions} />
      <HomeStack.Screen name="ProjectChat" component={ProjectChatScreen} options={headerOptions} />
      <HomeStack.Screen name="Call" component={CallScreen} options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <HomeStack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ ...headerOptions, title: "Help & Support" }} />
      <HomeStack.Screen name="SupportChat" component={SupportChatScreen} options={({ route }: any) => ({ ...headerOptions, title: route.params?.title ?? "Support" })} />
    </HomeStack.Navigator>
  );
}

export function RootNavigator() {
  const { user, loading } = useAuth();
  const { palette } = useTheme();

  const navTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: palette.bg,
      card: palette.bgElevated,
      border: palette.border,
      primary: palette.accent,
      text: palette.textPrimary,
    },
  };

  if (loading) return null;

  return (
    <NavigationContainer theme={navTheme}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <RootStack.Screen name="Auth" component={AuthScreen} />
        ) : !user.onboardingCompletedAt ? (
          <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <RootStack.Screen name="Home" component={HomeFlow} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
