import React from "react";
import { View, ActivityIndicator } from "react-native";
import { NavigationContainer, DefaultTheme, LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import { useAuth } from "@/contexts/AuthContext";
import { Colors } from "@/constants/theme";
import { AuthStackParamList, RootStackParamList } from "./types";
import { MainTabs } from "./MainTabs";

import WelcomeScreen from "@/screens/auth/WelcomeScreen";
import PhoneSignInScreen from "@/screens/auth/PhoneSignInScreen";
import EmailSignInScreen from "@/screens/auth/EmailSignInScreen";
import OtpVerifyScreen from "@/screens/auth/OtpVerifyScreen";
import UsernameSetupScreen from "@/screens/auth/UsernameSetupScreen";

import ListingDetailScreen from "@/screens/ListingDetailScreen";
import EditListingScreen from "@/screens/EditListingScreen";
import BoostListingScreen from "@/screens/BoostListingScreen";
import BoostReturnScreen from "@/screens/BoostReturnScreen";
import ImageViewerScreen from "@/screens/ImageViewerScreen";
import CartScreen from "@/screens/CartScreen";
import CheckoutScreen from "@/screens/CheckoutScreen";
import CheckoutReturnScreen from "@/screens/CheckoutReturnScreen";
import OrdersScreen from "@/screens/OrdersScreen";
import OrderDetailScreen from "@/screens/OrderDetailScreen";
import NotificationsScreen from "@/screens/NotificationsScreen";
import ReportScreen from "@/screens/ReportScreen";
import SellerPayoutSetupScreen from "@/screens/SellerPayoutSetupScreen";
import IdentityVerificationScreen from "@/screens/IdentityVerificationScreen";
import NotificationFiltersScreen from "@/screens/NotificationFiltersScreen";
import ReadReceiptSettingsScreen from "@/screens/ReadReceiptSettingsScreen";
import BlockedUsersScreen from "@/screens/BlockedUsersScreen";
import SubscriptionScreen from "@/screens/SubscriptionScreen";
import SubscriptionReturnScreen from "@/screens/SubscriptionReturnScreen";
import RemoveAdsScreen from "@/screens/RemoveAdsScreen";
import RemoveAdsReturnScreen from "@/screens/RemoveAdsReturnScreen";
import FollowersScreen from "@/screens/FollowersScreen";
import OwnerPanelScreen from "@/screens/owner/OwnerPanelScreen";
import OwnerReportDetailScreen from "@/screens/owner/OwnerReportDetailScreen";
import OwnerUsersScreen from "@/screens/owner/OwnerUsersScreen";
import OwnerUserDetailScreen from "@/screens/owner/OwnerUserDetailScreen";
import UserSearchScreen from "@/screens/UserSearchScreen";
import UserProfileScreen from "@/screens/UserProfileScreen";
import FriendRequestsScreen from "@/screens/FriendRequestsScreen";
import ChatThreadScreen from "@/screens/ChatThreadScreen";
import ArchivedChatsScreen from "@/screens/ArchivedChatsScreen";
import HelpChatScreen from "@/screens/HelpChatScreen";
import PriceCardDetailScreen from "@/screens/PriceCardDetailScreen";
import HuntScreen from "@/screens/HuntScreen";
import HuntEntryReturnScreen from "@/screens/HuntEntryReturnScreen";
import HuntUserStatsScreen from "@/screens/HuntUserStatsScreen";
import OwnerHuntScreen from "@/screens/owner/OwnerHuntScreen";
import OwnerHuntNotifyScreen from "@/screens/owner/OwnerHuntNotifyScreen";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: Colors.background, primary: Colors.primary },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShadowVisible: false, headerTitle: "", headerTintColor: Colors.text, headerTransparent: true }}>
      <AuthStack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
      <AuthStack.Screen name="PhoneSignIn" component={PhoneSignInScreen} />
      <AuthStack.Screen name="EmailSignIn" component={EmailSignInScreen} />
      <AuthStack.Screen name="OtpVerify" component={OtpVerifyScreen} />
      <AuthStack.Screen name="UsernameSetup" component={UsernameSetupScreen} />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  return (
    <RootStack.Navigator
      screenOptions={{
        headerTintColor: Colors.text,
        headerStyle: { backgroundColor: Colors.background },
        // Explicit, not just the default: on iOS a plain-style native header
        // can render as a translucent glass bar that blurs/overlays the
        // content scrolling underneath it (recent iOS versions do this by
        // default). Product photos need a solid bar above them, not behind
        // one, so every screen in this stack forces an opaque header.
        headerTransparent: false,
        headerBlurEffect: "none",
      }}
    >
      <RootStack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <RootStack.Screen name="ListingDetail" component={ListingDetailScreen} options={{ title: "", headerTransparent: false, headerStyle: { backgroundColor: Colors.background } }} />
      <RootStack.Screen name="EditListing" component={EditListingScreen} options={{ title: "Edit Listing" }} />
      <RootStack.Screen name="BoostListing" component={BoostListingScreen} options={{ title: "Boost Listing" }} />
      <RootStack.Screen name="BoostReturn" component={BoostReturnScreen} options={{ title: "", headerBackVisible: false }} />
      <RootStack.Screen name="ImageViewer" component={ImageViewerScreen} options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <RootStack.Screen name="Cart" component={CartScreen} options={{ title: "Your Cart" }} />
      <RootStack.Screen name="Checkout" component={CheckoutScreen} options={{ title: "Checkout" }} />
      <RootStack.Screen name="CheckoutReturn" component={CheckoutReturnScreen} options={{ title: "", headerBackVisible: false }} />
      <RootStack.Screen name="Orders" component={OrdersScreen} options={{ title: "My Orders" }} />
      <RootStack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: "Order Details" }} />
      <RootStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <RootStack.Screen name="Report" component={ReportScreen} options={{ title: "Report a listing", presentation: "modal" }} />
      <RootStack.Screen name="SellerPayoutSetup" component={SellerPayoutSetupScreen} options={{ title: "Payout Setup" }} />
      <RootStack.Screen name="IdentityVerification" component={IdentityVerificationScreen} options={{ title: "Verify Identity" }} />
      <RootStack.Screen name="NotificationFilters" component={NotificationFiltersScreen} options={{ title: "New Card Alerts" }} />
      <RootStack.Screen name="ReadReceiptSettings" component={ReadReceiptSettingsScreen} options={{ title: "Read Receipts" }} />
      <RootStack.Screen name="BlockedUsers" component={BlockedUsersScreen} options={{ title: "Blocked Users" }} />
      <RootStack.Screen name="Subscription" component={SubscriptionScreen} options={{ title: "PullMarket Pro" }} />
      <RootStack.Screen name="SubscriptionReturn" component={SubscriptionReturnScreen} options={{ title: "", headerBackVisible: false }} />
      <RootStack.Screen name="RemoveAds" component={RemoveAdsScreen} options={{ title: "Remove Ads" }} />
      <RootStack.Screen name="RemoveAdsReturn" component={RemoveAdsReturnScreen} options={{ title: "", headerBackVisible: false }} />
      <RootStack.Screen name="Followers" component={FollowersScreen} options={({ route }) => ({ title: `@${route.params.username}'s followers` })} />
      <RootStack.Screen name="OwnerPanel" component={OwnerPanelScreen} options={{ title: "Owner Panel" }} />
      <RootStack.Screen name="OwnerReportDetail" component={OwnerReportDetailScreen} options={{ title: "Incident Report" }} />
      <RootStack.Screen name="OwnerUsers" component={OwnerUsersScreen} options={{ title: "All Users" }} />
      <RootStack.Screen
        name="OwnerUserDetail"
        component={OwnerUserDetailScreen}
        options={({ route }) => ({ title: `@${route.params.username}` })}
      />
      <RootStack.Screen name="UserSearch" component={UserSearchScreen} options={{ title: "New message" }} />
      <RootStack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: "" }} />
      <RootStack.Screen name="FriendRequests" component={FriendRequestsScreen} options={{ title: "Friend requests" }} />
      <RootStack.Screen name="ArchivedChats" component={ArchivedChatsScreen} options={{ title: "Archived chats" }} />
      <RootStack.Screen name="HelpChat" component={HelpChatScreen} options={{ title: "Help Assistant" }} />
      <RootStack.Screen name="ChatThread" component={ChatThreadScreen} options={{ title: "" }} />
      <RootStack.Screen name="PriceCardDetail" component={PriceCardDetailScreen} options={{ title: "" }} />
      <RootStack.Screen name="Hunt" component={HuntScreen} options={{ title: "Card Hunt" }} />
      <RootStack.Screen name="HuntEntryReturn" component={HuntEntryReturnScreen} options={{ title: "", headerBackVisible: false }} />
      <RootStack.Screen name="HuntUserStats" component={HuntUserStatsScreen} options={({ route }) => ({ title: `@${route.params.username}` })} />
      <RootStack.Screen name="OwnerHunt" component={OwnerHuntScreen} options={{ title: "Card Hunt" }} />
      <RootStack.Screen name="OwnerHuntNotify" component={OwnerHuntNotifyScreen} options={{ title: "Notify Users" }} />
    </RootStack.Navigator>
  );
}

// Lets Stripe's hosted checkout and identity-verification flows redirect
// straight back into the app — `checkout-return` resolves to
// `pullmarket://checkout-return` on native and `<web origin>/checkout-return`
// on web (see CartScreen, which builds the same URL via Linking.createURL to
// hand Stripe as success/cancel_url); `identity-verification` works the same
// way for the Stripe Identity flow (see IdentityVerificationScreen).
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL("/")],
  config: {
    screens: {
      MainTabs: "",
      CheckoutReturn: "checkout-return",
      IdentityVerification: "identity-verification",
      SubscriptionReturn: "subscription-return",
      RemoveAdsReturn: "remove-ads-return",
      BoostReturn: "boost-return",
      HuntEntryReturn: "hunt-entry-return",
    },
  },
};

export function RootNavigator() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme} linking={user ? linking : undefined}>
      {user ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
