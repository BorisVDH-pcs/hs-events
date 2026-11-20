package com.hsevents.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The drops the player's team can hand in right now: every drop option of
 * every tile the team can see and has not completed. It comes from the server
 * (plugin_watchlist, built on tiles_for_team) and is kept in memory only.
 *
 * The plugin never decides what a locked region holds: a tile the team cannot
 * see is simply not in here, so a drop for it matches nothing.
 */
public final class WatchList
{
	/** One drop option of one open tile. */
	public static final class Wanted
	{
		public final String gameId;
		public final String tileId;
		public final String tileName;
		public final String optionId;
		public final String label;

		public Wanted(String gameId, String tileId, String tileName, String optionId, String label)
		{
			this.gameId = gameId;
			this.tileId = tileId;
			this.tileName = tileName;
			this.optionId = optionId;
			this.label = label;
		}
	}

	/** What to do with a drop. The plugin never guesses between two tiles. */
	public enum Verdict
	{
		/** No open tile lists it: nothing leaves the computer. */
		NONE,
		/** Exactly one does: hand it in. */
		ONE,
		/** More than one does: the player chooses. */
		ASK
	}

	private final Map<String, List<Wanted>> byKey = new HashMap<>();
	private int size;

	public void add(Wanted wanted)
	{
		String key = DropKey.of(wanted.label);
		if (key == null)
		{
			return;
		}
		byKey.computeIfAbsent(key, k -> new ArrayList<>()).add(wanted);
		size++;
	}

	/** Every open tile option that lists an item of this name. */
	public List<Wanted> matches(String itemName)
	{
		String key = DropKey.of(itemName);
		List<Wanted> found = key == null ? null : byKey.get(key);
		return found == null ? Collections.emptyList() : Collections.unmodifiableList(found);
	}

	public Verdict verdict(String itemName)
	{
		int n = matches(itemName).size();
		return n == 0 ? Verdict.NONE : n == 1 ? Verdict.ONE : Verdict.ASK;
	}

	public int size()
	{
		return size;
	}

	public boolean isEmpty()
	{
		return size == 0;
	}
}
