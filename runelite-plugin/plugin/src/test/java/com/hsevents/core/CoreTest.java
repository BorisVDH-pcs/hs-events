package com.hsevents.core;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The same checks as CoreSelfTest, so that {@code ./gradlew test} runs them too. */
public class CoreTest
{
	@Test
	public void allCoreChecksPass()
	{
		assertEquals("failed checks (see the output above)", 0, CoreSelfTest.run());
	}
}
