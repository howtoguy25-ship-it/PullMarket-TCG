import React, { useRef, useState } from "react";
import { View, StyleSheet, Image, Pressable, Dimensions, FlatList, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/types";
import { resolveImageUrl } from "@/lib/media";

type Nav = NativeStackNavigationProp<RootStackParamList, "ImageViewer">;
type Rt = RouteProp<RootStackParamList, "ImageViewer">;

const { width, height } = Dimensions.get("window");

export default function ImageViewerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { images, startIndex } = route.params;
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(startIndex);
  const listRef = useRef<FlatList>(null);

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={images}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
            <Image source={{ uri: resolveImageUrl(item) }} style={styles.image} resizeMode="contain" />
          </View>
        )}
      />
      <Pressable onPress={() => navigation.goBack()} style={[styles.closeButton, { top: insets.top + Spacing.sm }]} hitSlop={10}>
        <Feather name="x" size={26} color={Colors.white} />
      </Pressable>
      {images.length > 1 ? (
        <View style={[styles.counter, { bottom: insets.bottom + Spacing.lg }]}>
          <Text style={styles.counterText}>
            {index + 1} / {images.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  image: { width, height: height * 0.85 },
  closeButton: { position: "absolute", right: Spacing.lg, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, padding: 8 },
  counter: { position: "absolute", alignSelf: "center", backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: 14 },
  counterText: { color: Colors.white, fontWeight: "700" },
});
