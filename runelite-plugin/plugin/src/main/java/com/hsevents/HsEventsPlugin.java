package com.hsevents;

import com.google.inject.Provides;
import com.hsevents.core.WatchList;
import java.util.List;
import javax.inject.Inject;
import lombok.extern.slf4j.Slf4j;
import net.runelite.client.config.ConfigManager;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.game.ItemManager;
import net.runelite.client.game.ItemStack;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import net.runelite.client.plugins.loottracker.LootReceived;

/**
 * FIRST SKELETON. Compiles against RuneLite 1.13.7 with no warnings
 * (gradle build, 2026-11-21), so every RuneLite name below exists. It has
 * never been loaded in a client.
 *
 * What it does today: on loot, asks the watch list for a verdict and logs it.
 * It sends nothing anywhere. The watch list stays empty until the server's
 * plugin_watchlist exists, so today every drop is a NONE.
 *
 * It reads and reports. It never acts in the game.
 */
@Slf4j
@PluginDescriptor(
	name = "High Society Events",
	description = "Hands in drops for your team's open tiles and shows event news in game",
	tags = {"bingo", "clan", "event", "drops"}
)
public class HsEventsPlugin extends Plugin
{
	@Inject
	private HsEventsConfig config;

	@Inject
	private ItemManager itemManager;

	/** Replaced whole, never edited in place, so the loot handler always sees a complete list. */
	private volatile WatchList watchList = new WatchList();

	@Provides
	HsEventsConfig provideConfig(ConfigManager configManager)
	{
		return configManager.getConfig(HsEventsConfig.class);
	}

	@Override
	protected void startUp()
	{
		watchList = new WatchList();
		// TODO (after plugin_watchlist exists): fetch it here and at login, off the client thread.
	}

	@Override
	protected void shutDown()
	{
		watchList = new WatchList();
	}

	@Subscribe
	public void onLootReceived(LootReceived event)
	{
		WatchList list = watchList;
		if (list.isEmpty())
		{
			return;
		}
		// TODO (before anything is sent): nothing on a seasonal world, i.e. when
		// client.getWorldType() contains WorldType.SEASONAL. Decided 2026-11-21:
		// a Leagues drop does not count. The intake already refuses it.

		for (ItemStack stack : event.getItems())
		{
			// Only ever the local player's own loot. Nothing about anybody else is read.
			String name = itemManager.getItemComposition(stack.getId()).getMembersName();
			List<WatchList.Wanted> wanted = list.matches(name);

			switch (list.verdict(name))
			{
				case NONE:
					break;
				case ONE:
					log.debug("{} is wanted by tile {}", name, wanted.get(0).tileName);
					// TODO: if config.submitDrops(), screenshot and post to intake.
					break;
				case ASK:
					log.debug("{} is wanted by {} tiles; the player chooses", name, wanted.size());
					// TODO: offer the choice in the side panel. Never pick one.
					break;
			}
		}
	}
}
