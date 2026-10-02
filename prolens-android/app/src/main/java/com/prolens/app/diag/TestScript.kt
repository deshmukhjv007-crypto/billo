package com.prolens.app.diag

/** One guided test: what the tester should do, and what Prolens should do in response. */
data class TestStep(val id: String, val title: String, val todo: String, val expect: String)

/** The guided test, in order. Each step takes under a minute. */
object TestScript {
    val steps = listOf(
        TestStep("portrait", "Face, arm's length",
            "Auto preset. Point the back camera at someone's face about 1 m away.",
            "Top bar switches to PORTRAIT, a box sits on the face, tips say step closer/back or tilt as needed."),
        TestStep("group", "Group of people",
            "Point at 3 or more people (a group photo on a laptop screen also works).",
            "Top bar shows GROUP and boxes appear on several faces."),
        TestStep("level", "Tilt the phone",
            "Point at a door or horizon, then tilt the phone sideways a little.",
            "Level bar turns yellow and a 'rotate' tip appears; it turns green when straight."),
        TestStep("food", "Food from above",
            "Hold the phone flat over a plate or any object on a table.",
            "Top bar shows FOOD, and a ring appears in the middle when you are straight above."),
        TestStep("backlit", "Window behind a person",
            "Put a person (or yourself on the front camera) in front of a bright window.",
            "Exposure goes up (+EV in the top bar) and the face does not look black. HDR is suggested if your phone has it."),
        TestStep("dark", "Dark room",
            "Switch off the lights, leaving a little light, and point at the room.",
            "Top bar shows NIGHT; Night mode is suggested, or a tip to hold steady."),
        TestStep("shake", "Shake test",
            "Shake the phone gently, then hold it still.",
            "'Hold steady' appears while shaking and disappears when still."),
        TestStep("shot", "Take a photo",
            "Take any photo when the shutter ring is green.",
            "Review opens with a score and tips that make sense. The photo is in your gallery."),
        TestStep("seller_good", "Seller Studio, good setup",
            "Pick Seller Studio. Put a small product on a white sheet near a window. Follow the checklist until all ticks are green, shoot, then tap Make listing image.",
            "Checklist goes all green, a dashed square frames the product, the listing image is a clean white square."),
        TestStep("seller_bad", "Seller Studio, bad background",
            "Seller Studio. Put the product on a patterned cloth or a dark table.",
            "Checklist says the background is uneven or grey."),
        TestStep("selfie", "Front camera",
            "Flip to the front camera and look at yourself.",
            "Face box follows your face (mirrored correctly), tips still make sense."),
        TestStep("pro", "Pro lock",
            "Tap a locked preset (Night or Landscape). Then in Settings turn on 'Unlock Pro for testing' and try again.",
            "First the Pro screen opens; after unlocking, the preset works.")
    )
}
