import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { HeaderIconButton } from '@/components/header-button';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { useWebStatusBarHeight } from '@/lib/use-web-status-bar-height';
import { Colors } from '@/theme';

type TabIconName = SymbolViewProps['name'];

function tabIcon(name: TabIconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <SymbolView name={name} tintColor={color} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const webStatusBarHeight = useWebStatusBarHeight();
  return (
    <Tabs
      screenOptions={{
        headerStatusBarHeight: webStatusBarHeight,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        tabBarStyle: { backgroundColor: Colors.tabBar, borderTopColor: Colors.border },
        tabBarActiveTintColor: Colors.tabIconSelected,
        tabBarInactiveTintColor: Colors.tabIconDefault,
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderIconButton
                label="Challenges"
                icon={{ ios: 'flag.checkered', android: 'sports_score', web: 'sports_score' }}
                onPress={() => router.push('/challenges')}
              />
              <NotificationBell />
            </View>
          ),
          tabBarIcon: tabIcon({ ios: 'list.bullet', android: 'list', web: 'list' }),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Me',
          tabBarIcon: tabIcon({ ios: 'person.fill', android: 'person', web: 'person' }),
        }}
      />
      <Tabs.Screen
        name="add-game"
        options={{
          title: 'Add game',
          tabBarIcon: tabIcon({
            ios: 'plus.circle.fill',
            android: 'add_circle',
            web: 'add_circle',
          }),
        }}
      />
      <Tabs.Screen
        name="tournaments"
        options={{
          title: 'Tournaments',
          headerTitle: 'Explore tournaments',
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderIconButton
                label="Groups"
                icon={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
                onPress={() => router.push('/groups')}
              />
              <HeaderIconButton
                label="Create a tournament"
                icon={{ ios: 'plus', android: 'add', web: 'add' }}
                onPress={() => router.push('/new-tournament')}
              />
            </View>
          ),
          tabBarIcon: tabIcon({ ios: 'trophy.fill', android: 'emoji_events', web: 'emoji_events' }),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: tabIcon({ ios: 'gearshape.fill', android: 'settings', web: 'settings' }),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerButtons: { flexDirection: 'row', alignItems: 'center' },
});
