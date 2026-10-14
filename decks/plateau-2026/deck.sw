// Editable PLATEAU 2026 deck; speaker notes preserved from the actual talk.
Deck {
  name: "Data-oriented Debugging with autopsy"
  subtitle: "PLATEAU 2026"
  width: 1920
  height: 1080
  slides: [
    // Slide 1
    Slide {
      label: "Data-oriented Debugging with autopsy"
      chromeless: true
      notes: "Hello! I'm Jeff, a PhD student at Penn, and today I'm excited to tell you about Data-oriented Debugging, which is a new approach for thinking about the debugging process and debugging tools, and about autopsy, a new debugger that implements some of these ideas."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 270
              width: 1330
              height: 260
              font: "body"
              fontSize: 100
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Data-oriented Debugging with"
                  ]
                }
              ]
            }
            Box {
              x: 125
              y: 550
              width: 545
              height: 125
              fill: "#0000FF"
            }
            TextBox {
              x: 140
              y: 555
              width: 550
              height: 130
              font: "mono"
              fontSize: 98
              fontWeight: "700"
              lineHeight: 1.25
              color: "#fff"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "autopsy"
                  ]
                }
              ]
            }
            TextBox {
              x: 115
              y: 735
              width: 1260
              height: 150
              font: "body"
              fontSize: 45
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Jeffrey Tao, Xiaorui Liu, Ryan Marcus, Andrew Head"
                  ]
                }
              ]
            }
            TextBox {
              x: 115
              y: 895
              width: 1250
              height: 80
              font: "body"
              fontSize: 36
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "PLATEAU 2026"
                  ]
                }
              ]
            }
            Image {
              x: 1500
              y: 280
              width: 270
              height: 270
              src: plateauHeadshot
              alt: "Jeffrey Tao"
              fit: "cover"
              radius: 135
            }
            Image {
              x: 1500
              y: 610
              width: 270
              height: 170
              src: plateauPennHci
              alt: "Penn HCI Lab"
              fit: "contain"
              radius: 0
            }
          ]
        }
      }
    }
    // Slide 2
    Slide {
      label: "Why I Care About Debugging"
      chromeless: true
      notes: "Just to introduce where I'm coming from with debugging. I used to be a senior software engineer in the industry, where I worked on auth, notifications, client/server sync. All things that are procedural, highly stateful, highly complex, prone to bugs, and really annoying to debug. And in all that time I was one of those programmers who always used print statements to debug. But I found the debugging tools at my disposal unsatisfying."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Why I Care About Debugging"
                  ]
                }
              ]
            }
            TextBox {
              x: 120
              y: 300
              width: 1260
              height: 660
              font: "body"
              fontSize: 46
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                List {
                  style: "disc"
                  items: [
                    ListItem {
                      content: [
                        "Previously: Senior SWE @ Microsoft & MongoDB"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Auth, Notifications, Client/Server Sync, Dev Tools"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Highly stateful code, complex logic"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Now: DB & HCI @ Penn: tools for programmers"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Shameless print() debugger"
                      ]
                      spaceAfter: 22
                    }
                  ]
                }
              ]
            }
            Image {
              x: 1480
              y: 340
              width: 310
              height: 310
              src: plateauHeadshot
              alt: "Jeffrey Tao"
              fit: "cover"
              radius: 155
            }
          ]
        }
      }
    }
    // Slide 3
    Slide {
      label: "How do you debug this?"
      chromeless: true
      notes: "Let's start with an example to illustrate what I see are some issues with current debuggers. You're working on an online retail payment processing pipeline. It does some conventional things retailers do, such as giving a discount on bulk orders, and free shipping on orders above a certain cost.\n\nYou've maybe already spotted the bug: sometimes a customer will get a discount for a bulk order and that'll take away what was previously going to be their free shipping, which isn't a good experience. This is a toy example, but it represents a pretty common issue: the logic looks reasonable locally, but produces unreasonable results when composed.\n\n---\n\nWe're going to analyze how a programmer might use different debuggers to understand this problem. But first I need to introduce this visualization I call the state-time chart, which we'll use to understand what different debuggers can do. First, let me give you some intuition about how this chart works.\n\n---\n\nOn the vertical axis we have all state across all scopes of the program.\n\n---\n\nIn our toy example this is all of the fields of the item and the cart.\n\n---\n\nImagine these various pieces of the program state distributed at different locations along the vertical axis.\n\n---\n\nNext, the horizontal axis represents time. Really it's discretized by the program counter.\n\n---\n\nAs each statement in the program executes, computation happens. Take item price here -- as we process each item we calculate a price for it.\n\n---\n\nFor a certain row across the chart, a particular variable is taking on different values, with increasing time as we move to the right.\n\n---\n\nOkay that's the state-time chart. Let's use it to understand how a debugger works.\n\n---\n\nBreakpoint debugging pauses execution at a particular point in time. When paused, you have access to arbitrary state at every frame of the call stack, which is shown in the variables panel in the bottom right.\n\n---\n\nWhen I press continue, the program runs until it hits the breakpoint again, and I can see all of the state everywhere at this new moment.\n\nThis can be great! It leaves you flexible and doesn't require you to predict in advance what state will be relevant to your debugging.\n\n---\n\nAnd as I continue to use my breakpoint debugger, I'm proceeding through a sequence of stack traces, each of which is a complete vertical slice of state, but at a different point in time.\n\nSo I like that I can see all of the state and know that it's all related because it's all from the same moment in time, but I have to keep track of the history of how I got to this point in my head, and I have to decide when to pause and inspect state.\n\n---\n\nNext, let's examine print debugging.\n\n---\n\nWhen I add a print statement to the code,\n\n---\n\nwhen execution runs over the print statement, I get a log entry in my terminal, shown in the bottom right, that shows me the values of some variables that I choose at that moment in time.\n\n---\n\nAs the entire program executes, I get a bunch of logs in my terminal, each corresponding to a particular value taken on by a specific part of the program state. Each of these dots represents a particular log entry, which you can think of as storing that particular state-time value. They're arranged horizontally because they all represent state pulled from the same place in the code.\n\n---\n\nNow, if I add a second print line\n\n---\n\nas the program executes, I get logs whenever one of these print statements executes.\n\n---\n\nAnd when the whole program executes, I get logs from both print statements, extracting different states from different times. Programmers often insert multiple print statement probes in their code, precisely because, in contrast to breakpoints, it helps them understand sequences of events.\n\nBut recall the blue bars of the breakpoint debugger. You no longer have access to complete information about each moment in time.\n\nAnd also, where I put my print statements and how the program actually executes determines how the information I get is displayed to me. I don't have two neat, separated rows of logs. I have this zigzag interleaving of them. This helps me in situations where I want to understand the history of execution, but it makes it hard to understand the execution in any other way besides chronologically."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "How do you debug this?"
                  ]
                }
              ]
            }
            DebuggerDemo {
              x: 100
              y: 225
              width: 1720
              height: 780
            }
          ]
        }
      }
    }
    // Slide 4
    Slide {
      label: "Too Much / Too Little Information"
      chromeless: true
      notes: "We conducted interviews with 12 experienced industry software engineers to understand their debugging practices and why they preferred certain tools and techniques. One major theme that emerged was that their debugging strategies often involved this active negotiation with collecting and viewing information about execution.\n\nSometimes they worried about collecting too much. One participant told us that unnecessary information could cause them to lose out on the meaningful thing that would help them understand the bug.\n\nAnother participant said that a poorly placed breakpoint could disrupt their workflow if it was hit a lot.\n\n---\n\nOn the other hand, they also worried about not having enough information to understand their bugs. They felt this more acutely the longer it took to get new debugging data."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 115
              y: 70
              width: 1690
              height: 120
              font: "body"
              fontSize: 76
              fontWeight: "700"
              lineHeight: 1.25
              color: "#92400e"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Too Much Information"
                  ]
                }
              ]
            }
            TextBox {
              x: 135
              y: 205
              width: 1640
              height: 140
              font: "body"
              fontSize: 38
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "P3: \"you don't want to burn up your log files with unnecessary information…otherwise, you will lose out the meaningful logs\""
                  ]
                }
              ]
            }
            TextBox {
              x: 135
              y: 365
              width: 1640
              height: 140
              font: "body"
              fontSize: 38
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "P10: \"if it is something that's gonna get called a ton…putting a breakpoint inside that is gonna kind of drive me crazy\""
                  ]
                }
              ]
            }
            TextBox {
              x: 115
              y: 565
              width: 1690
              height: 120
              font: "body"
              fontSize: 76
              fontWeight: "700"
              lineHeight: 1.25
              color: "#1e40af"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Too Little Information"
                  ]
                }
              ]
            }
            TextBox {
              x: 135
              y: 700
              width: 1640
              height: 140
              font: "body"
              fontSize: 38
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "P5: \"oh, okay, this is happening. Okay, then what was the state before this? And you don't have a log for that…\""
                  ]
                }
              ]
            }
            TextBox {
              x: 135
              y: 860
              width: 1640
              height: 110
              font: "body"
              fontSize: 38
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "P12: \"I just print out everything. As much information as possible.\""
                  ]
                }
              ]
            }
          ]
        }
      }
    }
    // Slide 5
    Slide {
      label: "Two information needs in tension"
      chromeless: true
      notes: "This negotiation process puts these two instincts in tension. On the one hand, I'm inclined to collect more information because it'll help me make sense of the problem. But on the other hand, I worry that if I collect too much, I won't even be able understand what I'm looking at.\n\nNeeding to navigate this tension seems to me like incidental complexity of current debuggers, rather than an inherent part of debugging.\n\nI'm a databases person. When I hear this tension, my instinct is that I should be able to collect everything and that I should have good analysis tools that let me manage all of that data."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Two information needs in tension"
                  ]
                }
              ]
            }
            Box {
              x: 120
              y: 345
              width: 790
              height: 440
              fill: "#fffbeb"
            }
            Box {
              x: 1010
              y: 345
              width: 790
              height: 440
              fill: "#eff6ff"
            }
            TextBox {
              x: 150
              y: 380
              width: 715
              height: 125
              font: "body"
              fontSize: 76
              fontWeight: "700"
              lineHeight: 1.25
              color: "#92400e"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Collection"
                  ]
                }
              ]
            }
            TextBox {
              x: 150
              y: 530
              width: 715
              height: 220
              font: "body"
              fontSize: 48
              fontWeight: "400"
              lineHeight: 1.25
              color: "#78350f"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Collect more data — it may be useful in future analysis"
                  ]
                }
              ]
            }
            TextBox {
              x: 1040
              y: 380
              width: 715
              height: 125
              font: "body"
              fontSize: 76
              fontWeight: "700"
              lineHeight: 1.25
              color: "#1e40af"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Analysis"
                  ]
                }
              ]
            }
            TextBox {
              x: 1040
              y: 530
              width: 715
              height: 220
              font: "body"
              fontSize: 48
              fontWeight: "400"
              lineHeight: 1.25
              color: "#1e3a8a"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Make sense of data and avoid being overwhelmed by it"
                  ]
                }
              ]
            }
          ]
        }
      }
    }
    // Slide 6
    Slide {
      label: "Why are they in tension?"
      chromeless: true
      notes: "But where is this tension coming from in current debuggers? Well, the design of both debugging tools couples collection and analysis.\n\nThere's nothing you can do with print debugging output besides browsing it and performing text search on it. And your print statements fix output, forcing you to see only what you've logged, but also forcing you to see everything you've logged.\n\nOn the other hand, interactive debugging with a breakpoint debugger is almost the opposite: it forces you to continually make decisions about what data to collect next. You're constantly switching between deciding where to go next and analyzing what you can now see.\n\nOn the analysis side, neither has affordances to aid your reasoning beyond just showing you the data. I'll get back to that in a minute. First, let's examine what better collection could look like."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Why are they in tension?"
                  ]
                }
              ]
            }
            TextBox {
              x: 120
              y: 365
              width: 1510
              height: 660
              font: "body"
              fontSize: 55
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                List {
                  style: "disc"
                  items: [
                    ListItem {
                      content: [
                        "Current debuggers couple collecting execution data and analyzing it"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Current debuggers lack affordances for transforming and comprehending execution data"
                      ]
                      spaceAfter: 22
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
    // Slide 7
    Slide {
      label: "Collection"
      chromeless: true
      notes: "So we saw that breakpoints let you see all of the state at one particular moment in time.\n\n---\n\nAnd print statements let you see particular pieces of state across many moments in time, and in order.\n\n---\n\nWell, from a pure data collection perspective, it sure would be nice to get all state at all moments in time."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Collection"
                  ]
                }
              ]
            }
            StateTimeChart {
              x: 240
              y: 235
              width: 1440
              height: 790
              mode: "collection"
            }
          ]
        }
      }
    }
    // Slide 8
    Slide {
      label: "autopsy"
      chromeless: true
      notes: "This is exactly what we designed autopsy to do. The first part of autopsy is a python debugging library. The way you use it to instrument code looks a lot like print debugging: you just import log from autopsy and sprinkle calls to log throughout your code base.\n\nThe interesting extra bit is that it captures full stack traces, not just the expressions you pass it. Here, a full stack trace means every stack frame, and every variable in every stack frame. This is all of the information you get when paused on a breakpoint."
      content: PlateauSlide {
        content: Freeform {
          children: [
            Box {
              x: 125
              y: 95
              width: 550
              height: 120
              fill: "#0000FF"
            }
            TextBox {
              x: 135
              y: 95
              width: 550
              height: 140
              font: "mono"
              fontSize: 98
              fontWeight: "700"
              lineHeight: 1.25
              color: "#fff"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "autopsy"
                  ]
                }
              ]
            }
            Box {
              x: 120
              y: 340
              width: 1680
              height: 410
              fill: "#f9fafb"
            }
            TextBox {
              x: 155
              y: 370
              width: 1600
              height: 365
              font: "mono"
              fontSize: 48
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "import autopsy\n\n...\n\nautopsy.log(\"checkpoint\", order, total)"
                  ]
                }
              ]
            }
            TextBox {
              x: 125
              y: 830
              width: 1680
              height: 130
              font: "body"
              fontSize: 53
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "autopsy.log() calls capture full stack traces"
                  ]
                }
              ]
            }
          ]
        }
      }
    }
    // Slide 9
    Slide {
      label: "Call stack in History view"
      chromeless: true
      notes: "And so, one view of the autopsy interface is like your chronological print statement output, except that you can click on any log entry and see the full stack trace for that moment in time, just like you would see if you were paused at a breakpoint.\n\nIt gives you all of the data you asked for, and more on demand."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Call stack in History view"
                  ]
                }
              ]
            }
            Video {
              x: 100
              y: 235
              width: 1720
              height: 760
              src: plateauStackTrace
              label: "Call stack in History view"
              loop: true
              muted: true
              fit: "contain"
              radius: 12
            }
          ]
        }
      }
    }
    // Slide 10
    Slide {
      label: "Print Output → DataFrame?"
      chromeless: true
      notes: "Next, on to analysis affordances.\n\nThis project was partially born from me looking at the JavaScript console, looking at how different logs were separated by lines, and thinking to myself, \"Isn't this a table? Shouldn't I be able to do more things with this?\" which is when I began to see my debugging logs as a dataset in themselves, where I had previously been thinking of them as the end of where tooling could help me."
      content: PlateauSlide {
        content: Freeform {
          children: [
            Image {
              x: 90
              y: 240
              width: 780
              height: 630
              src: plateauConsole
              alt: "JavaScript console output"
              fit: "contain"
              radius: 0
            }
            Image {
              x: 1050
              y: 240
              width: 780
              height: 630
              src: plateauPandas
              alt: "Pandas DataFrame output"
              fit: "contain"
              radius: 0
            }
            Arrow {
              x1: 900
              y1: 560
              x2: 1015
              y2: 560
              strokeWidth: 5
              color: "#374151"
            }
            TextBox {
              x: 95
              y: 900
              width: 770
              height: 90
              font: "body"
              fontSize: 38
              fontWeight: "400"
              lineHeight: 1.25
              color: "#6b7280"
              align: "center"
              content: [
                Paragraph {
                  content: [
                    "Print Output"
                  ]
                }
              ]
            }
            TextBox {
              x: 1055
              y: 900
              width: 770
              height: 90
              font: "body"
              fontSize: 38
              fontWeight: "400"
              lineHeight: 1.25
              color: "#6b7280"
              align: "center"
              content: [
                Paragraph {
                  content: [
                    "DataFrame?"
                  ]
                }
              ]
            }
          ]
        }
      }
    }
    // Slide 11
    Slide {
      label: "Affordances — Streams"
      chromeless: true
      notes: "To start, we briefly hit upon this ordering problem of only being able to see logs chronologically. One obvious affordance is letting you isolate the logs from different places in your code."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Affordances — Streams"
                  ]
                }
              ]
            }
            StateTimeChart {
              x: 240
              y: 235
              width: 1440
              height: 790
              mode: "streams"
            }
          ]
        }
      }
    }
    // Slide 12
    Slide {
      label: "Streams demo"
      chromeless: true
      notes: "By default, autopsy shows you this chronological view. But if you switch to this Streams view, they're separated by statement, letting you see all of the logs produced at a particular point in your code. And since all of those logs have the same set of arguments, they're presented in a table view, which has some nice properties we're about to see."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Streams"
                  ]
                }
              ]
            }
            Video {
              x: 100
              y: 235
              width: 1720
              height: 760
              src: plateauStreams
              label: "Streams"
              loop: true
              muted: true
              fit: "contain"
              radius: 12
            }
          ]
        }
      }
    }
    // Slide 13
    Slide {
      label: "Affordances — Step Debugging"
      chromeless: true
      notes: "So autopsy can replace print debugging, and goes beyond it. But what about breakpoint debugging? We tried to give it a similar treatment for stepping. You should be able to follow along with the order that things were captured in.\n\nAt each point, we can show you the same information the breakpoint debugger would have shown you, because we're capturing the full stack trace. And since this is all post-hoc analysis of captured logs, we can do the omniscient debugging thing of letting you step forwards and backwards and jump to arbitrary points."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Affordances — “Step” Debugging"
                  ]
                }
              ]
            }
            StateTimeChart {
              x: 240
              y: 235
              width: 1440
              height: 790
              mode: "stepping"
            }
          ]
        }
      }
    }
    // Slide 14
    Slide {
      label: "Step Debugging demo"
      chromeless: true
      notes: "So here, next to any log in autopsy, I can click on this \"Show in code\" button, which gives me a code lens above the corresponding log statement. Then, I can click these buttons to step forwards and backwards through the logs. If I have multiple log statements, the view will jump around to them. And like I said, since I have the full stack trace, I can click on the log to see all of the information that a breakpoint debugger would have shown me.\n\nThe one glaring difference is that this doesn't give me the same stepping experience as breakpoints since it only works when I have log statements. We'll get back to that at the end."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Step Debugging"
                  ]
                }
              ]
            }
            Video {
              x: 100
              y: 235
              width: 1720
              height: 760
              src: plateauStepping
              label: "Step Debugging"
              loop: true
              muted: true
              fit: "contain"
              radius: 12
            }
          ]
        }
      }
    }
    // Slide 15
    Slide {
      label: "Affordances — Computed Columns"
      chromeless: true
      notes: "Well now that I've captured all of this extra context at each log line, it seems like I could do more with it. To help with the problem of not having logged the right things, you can now decide that you want to see this other state alongside what you're already seeing.\n\n---\n\nTo do so, you reach into that stack trace that you've captured for this log and pull out the relevant bit of state\n\n---\n\nAnd then your tool projects that for every log you have."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Affordances — Computed Columns"
                  ]
                }
              ]
            }
            StateTimeChart {
              x: 240
              y: 235
              width: 1440
              height: 790
              mode: "computed"
            }
          ]
        }
      }
    }
    // Slide 16
    Slide {
      label: "Computed Columns demo"
      chromeless: true
      notes: "So here's me doing that in autopsy. When I'm looking at this table, I can open the call stack and pull out other relevant state to create a new column.\n\nI can also compute arbitrary python expressions over the captured call stack and project it into a new column, like the total being the quantity times the price.\n\nAnd just like that, I can enrich my logs with new information on demand."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Computed Columns"
                  ]
                }
              ]
            }
            Video {
              x: 100
              y: 235
              width: 1720
              height: 760
              src: plateauComputed
              label: "Computed Columns"
              loop: true
              muted: true
              fit: "contain"
              radius: 12
            }
          ]
        }
      }
    }
    // Slide 17
    Slide {
      label: "Affordances — Grouping & Filtering"
      chromeless: true
      notes: "Last affordance I'll talk about today: ways of getting overviews of the logs and customizing your view.\n\n---\n\nTo make certain comparisons easier, or to narrow my focus to an interesting subset of the data, I should be able to say that I only care about logs with a particular characteristic. So I should be able to select only the stuff I care about...\n\n---\n\n...and then change my view of the logs to just those logs."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Affordances — Grouping & Filtering"
                  ]
                }
              ]
            }
            StateTimeChart {
              x: 240
              y: 235
              width: 1440
              height: 790
              mode: "filtering"
            }
          ]
        }
      }
    }
    // Slide 18
    Slide {
      label: "Grouping & Filtering demo"
      chromeless: true
      notes: "So in autopsy, next to each column header is a filter icon.\n\nI can see distributions of values, letting me easily understand properties of the captured data in aggregate. Is this the right distribution of values for this variable? Are there values in here that I don't expect?\n\nAnd then I can go and say \"oh I only care to see when free_shipping was True\". This also cross-filters my chronological view."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Grouping & Filtering"
                  ]
                }
              ]
            }
            Video {
              x: 100
              y: 235
              width: 1720
              height: 760
              src: plateauFiltering
              label: "Grouping & Filtering"
              loop: true
              muted: true
              fit: "contain"
              radius: 12
            }
          ]
        }
      }
    }
    // Slide 19
    Slide {
      label: "Future Work"
      chromeless: true
      notes: "Up next for this project, well as soon as I get back from PLATEAU I'm running a user study on this.\n\nWe'd also like to work on efficient capture and capture all statements automatically.\n\nI've only covered most most basic queries, I think you could do much more with this data.\n\nBeing able to make a code change and diff the traces could be really powerful as well.\n\nAnd lastly, I think letting coding agents query the dataset might be interesting, both for the agent coding loop and for creating explanations for humans."
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 65
              width: 1700
              height: 150
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Future Work"
                  ]
                }
              ]
            }
            TextBox {
              x: 120
              y: 270
              width: 1510
              height: 660
              font: "body"
              fontSize: 44
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                List {
                  style: "disc"
                  items: [
                    ListItem {
                      content: [
                        "Starting tomorrow: controlled lab study vs. print/breakpoints"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Capture all statements, no autopsy.log() calls"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "More complex queries (\"Pairs of logs where X happened, then Y\")"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Comparisons across multiple executions (\"How did my change affect the execution?\")"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Letting LLMs query the dataset, both for agentic loops and explanations"
                      ]
                      spaceAfter: 22
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
    // Slide 20
    Slide {
      label: "Closing / Discussion"
      chromeless: true
      notes: "So that's data-oriented debugging and autopsy. For discussion, I'd like to emphasize this first question especially: I'm running a study starting tomorrow, so if there are any questions you think I should be asking participants, please let me know!"
      content: PlateauSlide {
        content: Freeform {
          children: [
            TextBox {
              x: 110
              y: 55
              width: 1700
              height: 190
              font: "body"
              fontSize: 82
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Data-oriented debugging with autopsy"
                  ]
                }
              ]
            }
            TextBox {
              x: 120
              y: 270
              width: 1510
              height: 210
              font: "body"
              fontSize: 44
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                List {
                  style: "disc"
                  items: [
                    ListItem {
                      content: [
                        "Separate collection and analysis"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "New analysis affordances over captured data"
                      ]
                      spaceAfter: 22
                    }
                  ]
                }
              ]
            }
            TextBox {
              x: 110
              y: 520
              width: 1700
              height: 120
              font: "body"
              fontSize: 76
              fontWeight: "700"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                Paragraph {
                  content: [
                    "Discussion"
                  ]
                }
              ]
            }
            TextBox {
              x: 120
              y: 685
              width: 1510
              height: 325
              font: "body"
              fontSize: 40
              fontWeight: "400"
              lineHeight: 1.25
              color: "#111"
              align: "left"
              content: [
                List {
                  style: "disc"
                  items: [
                    ListItem {
                      content: [
                        "Any questions you would want to ask participants of my study?"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Is this the right way to think about debugging tools?"
                      ]
                      spaceAfter: 22
                    }
                    ListItem {
                      content: [
                        "Other things you can imagine doing with full traces?"
                      ]
                      spaceAfter: 22
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  ]
}
