import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'back' | 'chevron' | 'plus' | 'search' | 'bell' | 'tent' | 'star' | 'compass' | 'calendar'
  | 'car' | 'chat' | 'user' | 'flag' | 'trash' | 'edit' | 'close' | 'eye' | 'eyeOff' | 'pin' | 'globe' | 'logout';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
}

/** Line icons drawn to match the mockups. Always decorative — label the button, not the icon. */
export function Icon({ name, size = 20, color = '#F2EDE1', fill = 'none', strokeWidth = 2 }: Props) {
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  let body: React.ReactNode;
  switch (name) {
    case 'back': body = <Path d="m15 6-6 6 6 6" {...common} />; break;
    case 'chevron': body = <Path d="m9 6 6 6-6 6" {...common} />; break;
    case 'plus': body = <Path d="M12 5v14M5 12h14" {...common} />; break;
    case 'close': body = <Path d="M6 6l12 12M18 6 6 18" {...common} />; break;
    case 'search': body = <>{<Circle cx={11} cy={11} r={7} {...common} />}<Path d="m20 20-3.5-3.5" {...common} /></>; break;
    case 'bell': body = <><Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" {...common} /><Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" {...common} /></>; break;
    case 'tent': body = <><Path d="M3 20 12 4l9 16" {...common} /><Path d="M9 20l3-6 3 6" {...common} /></>; break;
    case 'star': body = <Path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" {...common} fill={fill} />; break;
    case 'compass': body = <><Circle cx={12} cy={12} r={9} {...common} /><Path d="m15.5 8.5-2 5-5 2 2-5z" {...common} /></>; break;
    case 'calendar': body = <><Rect x={3} y={5} width={18} height={16} rx={2} {...common} /><Path d="M16 3v4M8 3v4M3 11h18" {...common} /></>; break;
    case 'car': body = <><Path d="M3 16v-3l2-5h14l2 5v3H3z" {...common} /><Circle cx={7.5} cy={17} r={2} {...common} /><Circle cx={16.5} cy={17} r={2} {...common} /></>; break;
    case 'chat': body = <Path d="M4 5h16v11H9l-5 4z" {...common} />; break;
    case 'user': body = <><Circle cx={12} cy={8} r={4} {...common} /><Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" {...common} /></>; break;
    case 'flag': body = <><Path d="M5 21V4" {...common} /><Path d="M5 4h12l-2 4 2 4H5" {...common} /></>; break;
    case 'trash': body = <><Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" {...common} /></>; break;
    case 'edit': body = <Path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" {...common} />; break;
    case 'eye': body = <><Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" {...common} /><Circle cx={12} cy={12} r={3} {...common} /></>; break;
    case 'eyeOff': body = <><Path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1.1" {...common} /></>; break;
    case 'pin': body = <><Path d="M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z" {...common} /><Circle cx={12} cy={9} r={2.5} {...common} /></>; break;
    case 'globe': body = <><Circle cx={12} cy={12} r={9} {...common} /><Path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" {...common} /></>; break;
    case 'logout': body = <><Path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" {...common} /></>; break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} importantForAccessibility="no-hide-descendants">
      {body}
    </Svg>
  );
}
