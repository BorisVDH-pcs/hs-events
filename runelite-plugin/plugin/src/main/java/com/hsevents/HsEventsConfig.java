package com.hsevents;

import net.runelite.client.config.Config;
import net.runelite.client.config.ConfigGroup;
import net.runelite.client.config.ConfigItem;

@ConfigGroup("hsevents")
public interface HsEventsConfig extends Config
{
	@ConfigItem(
		keyName = "token",
		name = "Plugin token",
		description = "Made on My Account on the High Society Events site. Not your password.",
		secret = true,
		position = 1
	)
	default String token()
	{
		return "";
	}

	@ConfigItem(
		keyName = "submitDrops",
		name = "Hand in matching drops",
		description = "Sends a drop and its screenshot to High Society Events when one of your team's open tiles lists it."
			+ " Nothing is sent for any other drop.",
		warning = "This sends your in-game name, the drop and a screenshot, along with your IP address,"
			+ " to High Society Events, a third-party site not controlled or verified by the RuneLite developers.",
		position = 2
	)
	default boolean submitDrops()
	{
		return false;
	}

	@ConfigItem(
		keyName = "popups",
		name = "Event pop-ups",
		description = "Shows event news in game: a tile completed, a region complete, time running out.",
		position = 3
	)
	default boolean popups()
	{
		return true;
	}
}
