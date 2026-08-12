export type AuthStackParamList = {
  Welcome: undefined;
  PhoneSignIn: undefined;
  EmailSignIn: undefined;
  OtpVerify: { destination: string; channel: "sms" | "email" };
  UsernameSetup: {
    destination?: string;
    channel?: "sms" | "email";
    googleId?: string;
    appleId?: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string;
  };
};

export type RootStackParamList = {
  MainTabs: undefined;
  ListingDetail: { listingId: string };
  ImageViewer: { images: string[]; startIndex: number };
  Cart: undefined;
  CheckoutReturn: { status?: string; order?: string };
  Orders: { role?: "buyer" | "seller" };
  OrderDetail: { orderId: string };
  Notifications: undefined;
  Report: { listingId?: string; orderId?: string; conversationId?: string; reportedUserId?: string; reportedUsername?: string };
  SellerPayoutSetup: undefined;
  IdentityVerification: undefined;
  NotificationFilters: undefined;
  OwnerPanel: undefined;
  OwnerReportDetail: { reportId: string };
  OwnerUsers: undefined;
  UserSearch: undefined;
  UserProfile: { userId: string };
  FriendRequests: undefined;
  ChatThread: { conversationId: string; otherUserId?: string };
};

export type MainTabsParamList = {
  Home: undefined;
  Search: undefined;
  Sell: undefined;
  Messages: undefined;
  Favorites: undefined;
  Profile: undefined;
};
