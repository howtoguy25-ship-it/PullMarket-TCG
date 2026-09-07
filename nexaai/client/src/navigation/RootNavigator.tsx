import React from "react";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/AuthContext";
import { colors } from "../theme/colors";

import { AuthScreen } from "../screens/AuthScreen";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { ChatScreen } from "../screens/ChatScreen";
import { CameraAskScreen } from "../screens/CameraAskScreen";
import { PlansScreen } from "../screens/PlansScreen";
import { CreditsScreen } from "../screens/CreditsScreen";
import { AgentBuilderScreen } from "../screens/AgentBuilderScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { PermissionsScreen } from "../screens/PermissionsScreen";
import { CapabilitiesScreen } from "../screens/CapabilitiesScreen";
import { MemoryFilesScreen } from "../screens/MemoryFilesScreen";
import { ConnectorsScreen } from "../screens/ConnectorsScreen";

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();
const HomeStack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bgElevated,
    border: colors.border,
    primary: colors.accent,
    text: colors.textPrimary,
  },
};

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Chat: "chatbubble-ellipses",
  Camera: "camera",
  Plans: "flash",
  Credits: "wallet",
  Agents: "hardware-chip",
  Settings: "settings",
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.bgElevated },
        headerTitleStyle: { color: colors.textPrimary },
        tabBarStyle: { backgroundColor: colors.bgElevated, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accentBright,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color, size }) => <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Camera" component={CameraAskScreen} options={{ title: "Ask with camera" }} />
      <Tab.Screen name="Plans" component={PlansScreen} />
      <Tab.Screen name="Credits" component={CreditsScreen} />
      <Tab.Screen name="Agents" component={AgentBuilderScreen} options={{ title: "My agents" }} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// Wraps the tab bar in a stack so Settings can push full-screen detail
// pages (Permissions, Capabilities, Connectors, Memory files) with a back
// button, without those pages needing their own tab.
function HomeFlow() {
  const headerOptions = {
    headerStyle: { backgroundColor: colors.bgElevated },
    headerTitleStyle: { color: colors.textPrimary },
    headerTintColor: colors.accentBright,
  };
  return (
    <HomeStack.Navigator>
      <HomeStack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <HomeStack.Screen name="Permissions" component={PermissionsScreen} options={headerOptions} />
      <HomeStack.Screen name="Capabilities" component={CapabilitiesScreen} options={headerOptions} />
      <HomeStack.Screen name="MemoryFiles" component={MemoryFilesScreen} options={{ ...headerOptions, title: "Memory files" }} />
      <HomeStack.Screen name="Connectors" component={ConnectorsScreen} options={headerOptions} />
    </HomeStack.Navigator>
  );
}

export function RootNavigator() {
  const { user, loading } = useAuth();
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
