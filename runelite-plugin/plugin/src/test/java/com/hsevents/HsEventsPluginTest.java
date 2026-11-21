package com.hsevents;

import net.runelite.client.RuneLite;
import net.runelite.client.externalplugins.ExternalPluginManager;

/**
 * Starts RuneLite with this plugin loaded, as the template does:
 * {@code ./gradlew run}. For the player to try in game; nothing here plays.
 */
public class HsEventsPluginTest
{
	public static void main(String[] args) throws Exception
	{
		ExternalPluginManager.loadBuiltin(HsEventsPlugin.class);
		RuneLite.main(args);
	}
}
