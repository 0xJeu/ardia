import { Surface } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { hex, useTheme } from "../ui/theme";
import { dismiss, joinEvent, useMeetingAlert } from "../../state/live/alerts";
import { useCalendar, useNow } from "../../state/live/calendar";
import { attendeesLabel, guestsLabel, joinLink, joinTitle, relatedLinks, relativeTime, timeRange, type CalendarEvent } from "../../state/live/meetings";
import { useWindow } from "../../state/browser/hooks";
import { useCalendarTabIn } from "../../state/live/hooks";
import { activate } from "../../state/tabs/actions";
import { useIsFocusedWindow } from "../../state/windows/hooks";
import { Button } from "../ui";
import { measureRow, type Anchor } from "../../state/sidebar/sidebarUi";
import { OverlappingAvatars } from "./CalendarPreview";
import { useLiveColors } from "./tokens";

const WIDTH = 300;

export function MeetingAlert({ windowId, windowWidth }: { windowId: string; windowWidth: number }) {
  const event = useMeetingAlert((s) => s.event);
  const front = useIsFocusedWindow(windowId);
  if (!event || !front) return null;
  return <AlertCard key={event.occurrence} event={event} windowId={windowId} windowWidth={windowWidth} />;
}

function AlertCard({ event, windowId, windowWidth }: { event: CalendarEvent; windowId: string; windowWidth: number }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const now = useNow(15_000);
  const calendarTab = useCalendarTabIn(windowId);
  const sidebarShown = useWindow(windowId, (w) => !!w?.sidebarOpen);
  const calendarName = useCalendar((s) => s.calendars.find((c) => c.id === event.calendarId)?.title);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    if (calendarTab && sidebarShown) void measureRow(windowId, calendarTab).then((a) => !cancelled && setAnchor(a));
    else setAnchor(null);
    return () => {
      cancelled = true;
    };
  }, [calendarTab, sidebarShown, windowWidth]);
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: true }).start();
  }, []);

  const link = joinLink(event);
  const related = relatedLinks(event);
  const running = event.start <= now;
  const people = event.attendees.filter((a) => !a.me);
  const who = attendeesLabel(event);
  const position = anchor ? { left: anchor.x + anchor.width + 8, top: Math.max(8, anchor.y - 4) } : { left: Math.max(8, windowWidth - WIDTH - 14), top: 52 };

  return (
    <Animated.View
      style={{
        position: "absolute",
        ...position,
        width: WIDTH,
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
      }}
    >
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={20}
        shadowOffset={[0, 8]}
        style={{ padding: 12, gap: 8 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2.5, backgroundColor: event.color }} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontWeight: "500", color: running ? colors.now : theme.textSecondary }}>
            {running ? "Now" : relativeTime(event.start, now)}
            {calendarName ? <Text style={{ fontWeight: "400", color: theme.textSecondary }}> · {calendarName}</Text> : null}
          </Text>
          <Button variant="icon" icon="xmark" size={9} weight="semibold" box={20} radius={6} onPress={() => dismiss(event)} tooltip="Ignore" style={{ marginRight: -4, marginTop: -2 }} />
        </View>
        <View style={{ gap: 2 }}>
          <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 18, fontWeight: "600", color: theme.textPrimary }}>
            {event.title || "Untitled event"}
          </Text>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>{timeRange(event)}</Text>
        </View>
        {people.length ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <OverlappingAvatars people={people} size={20} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
              {who || guestsLabel(event)}
            </Text>
          </View>
        ) : null}
        <View style={{ gap: 6, marginTop: 2 }}>
          {link ? (
            <Button variant="pill" tone="chip" title={joinTitle(link.provider)} icon="video.fill" primary height={30} onPress={() => joinEvent(event, false, windowId)} />
          ) : calendarTab ? (
            <Button
              variant="pill"
              tone="chip"
              title="View Event"
              icon="calendar"
              height={30}
              onPress={() => {
                activate(calendarTab);
                dismiss(event);
              }}
            />
          ) : null}
          {link && related.length ? (
            <View tooltip={`Opens ${related.length === 1 ? "1 link" : `${related.length} links`} from the invitation, then joins`}>
              <Button variant="pill" tone="chip" title="Open All and Join" icon="square.stack" height={30} onPress={() => joinEvent(event, true, windowId)} />
            </View>
          ) : null}
        </View>
      </Surface>
    </Animated.View>
  );
}

