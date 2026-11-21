package com.hsevents.core;

import java.util.Objects;

/**
 * Plain-Java self-test, no test library, so it runs with nothing but a JDK:
 *
 *   javac -d out src/main/java/com/hsevents/core/*.java src/test/java/com/hsevents/core/CoreSelfTest.java
 *   java -cp out com.hsevents.core.CoreSelfTest
 *
 * The drop_key cases are the same ones as server/test/tokens.test.mjs.
 */
public final class CoreSelfTest
{
	private static int pass;
	private static int fail;

	private static void ok(String name, boolean cond)
	{
		if (cond)
		{
			pass++;
		}
		else
		{
			fail++;
		}
		System.out.println((cond ? "ok   " : "FAIL ") + name);
	}

	private static void key(String input, String want)
	{
		ok("DropKey.of(" + input + ")", Objects.equals(DropKey.of(input), want));
	}

	public static void main(String[] args)
	{
		System.exit(run() == 0 ? 0 : 1);
	}

	/** Runs every check, prints each, and returns how many failed. CoreTest runs it under JUnit. */
	public static int run()
	{
		pass = 0;
		fail = 0;
		key("Dharok's helm", "dharoks helm");
		key("Dharok\u2019s  Helm ", "dharoks helm");
		key("dharoks helm", "dharoks helm");
		key("Black d'hide body (g)", "black dhide body g");
		key("Abyssal whip", "abyssal whip");
		key("3rd age full helmet", "3rd age full helmet");
		key("Tumeken's shadow (uncharged)", "tumekens shadow uncharged");
		key("  \u2019 ", null);
		key(null, null);

		WatchList list = new WatchList();
		list.add(new WatchList.Wanted("g1", "t1", "Barrows chest", "o1", "Dharok's helm"));
		list.add(new WatchList.Wanted("g1", "t1", "Barrows chest", "o2", "Karil's coif"));
		list.add(new WatchList.Wanted("g1", "t2", "Any helmet", "o3", "Dharoks helm"));
		list.add(new WatchList.Wanted("g1", "t3", "Odd one", "o4", " ' "));

		ok("an unmatchable label is not listed", list.size() == 3);
		ok("a drop no tile wants: NONE", list.verdict("Abyssal whip") == WatchList.Verdict.NONE);
		ok("a drop one tile wants: ONE", list.verdict("Karil's coif") == WatchList.Verdict.ONE);
		ok("it names the tile and the option",
			list.matches("KARIL'S COIF").get(0).tileId.equals("t1")
				&& list.matches("KARIL'S COIF").get(0).optionId.equals("o2"));
		ok("a drop two tiles want: ASK, never a guess", list.verdict("Dharok's helm") == WatchList.Verdict.ASK);
		ok("a nameless item matches nothing", list.verdict(null) == WatchList.Verdict.NONE);
		ok("an empty list matches nothing", new WatchList().verdict("Dharok's helm") == WatchList.Verdict.NONE);

		System.out.println("\n" + pass + " passed, " + fail + " failed");
		return fail;
	}
}
