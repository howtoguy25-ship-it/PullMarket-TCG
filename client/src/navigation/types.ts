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
  Checkout: { sellerId: string };
  CheckoutReturn: { status?: string; order?: string };
  Orders: { role?: "buyer" | "seller" };
  OrderDetail: { orderId: string };
  Notifications: undefined;
  Report: { listingId?: string; orderId?: string; conversationId?: string; reportedUserId?: string; reportedUsername?: string; messageId?: string };
  SellerPayoutSetup: undefined;
  IdentityVerification: undefined;
  NotificationFilters: undefined;
  ReadReceiptSettings: undefined;
  BlockedUsers: undefined;
  Subscription: undefined;
  SubscriptionReturn: { status?: string };
  RemoveAds: undefined;
  RemoveAdsReturn: { status?: string };
  Followers: { userId: string; username: string };
  OwnerPanel: undefined;
  OwnerReportDetail: { reportId: string };
  OwnerUsers: undefined;
  UserSearch: undefined;
  UserProfile: { userId: string };
  FriendRequests: undefined;
  ChatThread: { conversationId: string; otherUserId?: string };
  ArchivedChats: undefined;
  // Only scalar params — React Navigation's web URL sync stringifies
  // params with a plain String() for any screen not given a custom
  // linking config, which mangles a full object into "[object Object]"
  // in the address bar (breaks refresh/back-forward/deep-linking on
  // web). The detail screen re-reads the actual card data out of the
  // already-fetched Prices React Query cache using cardId + franchise.
  PriceCardDetail: {
    cardId: string;
    franchise: "pokemon" | "one_piece";
    franchiseLabel: string;
    color: string;
  };
};

export type MainTabsParamList = {
  Home: undefined;
  Search: undefined;
  Sell: undefined;
  Prices: undefined;
  Messages: undefined;
  Favorites: undefined;
  Profile: undefined;
};
