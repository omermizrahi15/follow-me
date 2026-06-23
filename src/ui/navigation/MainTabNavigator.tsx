import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { ConfigScreen } from '../screens/ConfigScreen';
import { SubscribersScreen } from '../screens/SubscribersScreen';
import { FloatingTabBar } from './FloatingTabBar';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Bottom tabs: Me / Auto-posting / Followers. The chrome lives in
 * {@link FloatingTabBar} — a floating Polarsteps-style frosted pill that hovers
 * over the screen content. Sharing media and settings are pushed pages reached
 * from the Me page rather than tabs.
 */
export function MainTabNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      tabBar={props => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Config" component={ConfigScreen} />
      <Tab.Screen name="Followers" component={SubscribersScreen} />
    </Tab.Navigator>
  );
}
