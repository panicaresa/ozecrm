import React from "react";
import { Image, View, ImageStyle, StyleProp, ViewStyle } from "react-native";

interface Props {
  height?: number;
  dark?: boolean; // invert colors via tintColor when on dark background
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// Logo ratio from asset: 500x95 ≈ 5.263
const RATIO = 500 / 95;

export const BrandLogo: React.FC<Props> = ({ height = 32, dark, style, testID }) => {
  const width = height * RATIO;
  const imgStyle: ImageStyle = { width, height };
  return (
    <View style={style} testID={testID}>
      <Image
        source={require("../../assets/brand/logo.png")}
        style={imgStyle}
        resizeMode="contain"
        // On dark surfaces, show the white variant via tintColor blending
        tintColor={dark ? "#FFFFFF" : undefined}
      />
    </View>
  );
};
