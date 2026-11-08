#!/usr/bin/env python3
"""Build public/bookstore/modern.json: recent (2014-2026) books for the collinslab bookstore.

Each candidate below is a hand-picked title with hand-written tagline and blurb.
Everything else is looked up and verified:

  * Open Library search finds the work (title and author must match);
  * the work's editions supply an English print edition with a 13-digit ISBN,
    preferring trade paperback/hardcover editions that carry a cover;
  * the ISBN must resolve on Open Library (/isbn/{isbn}.json) to the same work;
  * the cover id must serve a real image from covers.openlibrary.org
    (?default=false, so a missing cover is a 404) at least 151 px wide;
  * Google Books (q=isbn:...) supplies the volume id, page count fallback and
    preview flag, and its title must match when a volume is returned.

A candidate that fails verification is dropped and the next candidate of its
section is used, up to PER_SECTION books per section.  `isbn=` and `work=`
pin an edition or work when the automatic choice is wrong.

Usage:
    python3 tools/build_modern_catalog.py           # build the catalogue
    python3 tools/build_modern_catalog.py --check   # verify every candidate, write nothing
    python3 tools/build_modern_catalog.py --check "Piranesi"   # verify one title

Standard library only.  HTTP responses are cached in ~/.cache/collinslab/modern/
(a re-run makes no requests for anything already looked up).  Polite access:
descriptive User-Agent, >= 1.1 s between requests to each host, back-off on 429.
"""

import datetime
import html
import hashlib
import json
import os
import re
import struct
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "bookstore", "modern.json")
CACHE = os.path.expanduser("~/.cache/collinslab/modern")
UA = "collinslab-bookstore-catalog/1.0"
DELAY = 1.1
PER_SECTION = 12
MIN_COVER_WIDTH = 151
YEARS = (2014, 2026)

SECTIONS = [
    {"key": "fiction", "label": "New Fiction"},
    {"key": "adventure", "label": "Adventure, Travel & Speculative"},
    {"key": "gothic", "label": "Crime, Mystery & Horror"},
    {"key": "philosophy", "label": "Ideas & Essays"},
    {"key": "science", "label": "Science & Nature"},
    {"key": "poetry", "label": "Poetry & Drama"},
    {"key": "children", "label": "Children's & Middle Grade"},
    {"key": "society", "label": "History & Society"},
]

# Candidates in order of preference within each section; the first PER_SECTION
# that verify are used.  year = first publication (in any language).
def B(section, title, author, year, tagline="", blurb="", **kw):
    return dict(section=section, title=title, author=author, year=year,
                tagline=tagline, blurb=blurb, **kw)


BOOKS = [
    # ---------------------------------------------------------------- fiction
    B("fiction", "Lincoln in the Bardo", "George Saunders", 2017),
    B("fiction", "The Underground Railroad", "Colson Whitehead", 2016),
    B("fiction", "Hamnet", "Maggie O'Farrell", 2020),
    B("fiction", "Normal People", "Sally Rooney", 2018),
    # The top-ranked paperback's cover is a "cover to be revealed" placeholder.
    B("fiction", "Demon Copperhead", "Barbara Kingsolver", 2022, isbn="9780063251922"),
    B("fiction", "The Overstory", "Richard Powers", 2018),
    B("fiction", "Shuggie Bain", "Douglas Stuart", 2020),
    B("fiction", "Klara and the Sun", "Kazuo Ishiguro", 2021),
    B("fiction", "Small Things Like These", "Claire Keegan", 2021),
    B("fiction", "Homegoing", "Yaa Gyasi", 2016),
    B("fiction", "Tomorrow, and Tomorrow, and Tomorrow", "Gabrielle Zevin", 2022),
    B("fiction", "Prophet Song", "Paul Lynch", 2023),
    B("fiction", "James", "Percival Everett", 2024),
    B("fiction", "Trust", "Hernan Diaz", 2022),
    B("fiction", "Orbital", "Samantha Harvey", 2023),
    B("fiction", "Girl, Woman, Other", "Bernardine Evaristo", 2019),
    B("fiction", "Pachinko", "Min Jin Lee", 2017),
    # -------------------------------------------------------------- adventure
    B("adventure", "Project Hail Mary", "Andy Weir", 2021),
    B("adventure", "Piranesi", "Susanna Clarke", 2020),
    B("adventure", "The Fifth Season", "N. K. Jemisin", 2015),
    B("adventure", "Children of Time", "Adrian Tchaikovsky", 2015),
    B("adventure", "A Memory Called Empire", "Arkady Martine", 2019),
    B("adventure", "Circe", "Madeline Miller", 2018),
    B("adventure", "Gideon the Ninth", "Tamsyn Muir", 2019),
    B("adventure", "The Long Way to a Small, Angry Planet", "Becky Chambers", 2014),
    B("adventure", "The Wager", "David Grann", 2023),
    B("adventure", "Erebus", "Michael Palin", 2018),
    B("adventure", "Sea of Tranquility", "Emily St. John Mandel", 2022),
    B("adventure", "Babel", "R. F. Kuang", 2022),
    B("adventure", "The Ten Thousand Doors of January", "Alix E. Harrow", 2019),
    B("adventure", "All Systems Red", "Martha Wells", 2017),
    B("adventure", "Uprooted", "Naomi Novik", 2015),
    B("adventure", "Border", "Kapka Kassabova", 2017),
    # ----------------------------------------------------------------- gothic
    B("gothic", "Mexican Gothic", "Silvia Moreno-Garcia", 2020),
    B("gothic", "The Thursday Murder Club", "Richard Osman", 2020),
    B("gothic", "Magpie Murders", "Anthony Horowitz", 2016),
    B("gothic", "The Seven Deaths of Evelyn Hardcastle", "Stuart Turton", 2018),
    B("gothic", "The Only Good Indians", "Stephen Graham Jones", 2020),
    B("gothic", "Bunny", "Mona Awad", 2019),
    B("gothic", "The Searcher", "Tana French", 2020),
    B("gothic", "Razorblade Tears", "S. A. Cosby", 2021),
    B("gothic", "My Sister, the Serial Killer", "Oyinkan Braithwaite", 2018),
    B("gothic", "His Bloody Project", "Graeme Macrae Burnet", 2015),
    B("gothic", "Ninth House", "Leigh Bardugo", 2019),
    B("gothic", "Things We Lost in the Fire", "Mariana Enriquez", 2016, work="OL17319533W"),
    B("gothic", "The Appeal", "Janice Hallett", 2021),
    B("gothic", "The Hacienda", "Isabel Cañas", 2022),
    B("gothic", "The Silent Patient", "Alex Michaelides", 2019),
    # ------------------------------------------------------------- philosophy
    B("philosophy", "How to Do Nothing", "Jenny Odell", 2019),
    B("philosophy", "Four Thousand Weeks", "Oliver Burkeman", 2021),
    B("philosophy", "Trick Mirror", "Jia Tolentino", 2019),
    B("philosophy", "The Argonauts", "Maggie Nelson", 2015),
    B("philosophy", "Being Mortal", "Atul Gawande", 2014),
    B("philosophy", "At the Existentialist Café", "Sarah Bakewell", 2016),
    B("philosophy", "Metaphysical Animals", "Clare Mac Cumhaill & Rachael Wiseman", 2022,
      search_author="Mac Cumhaill"),
    B("philosophy", "The Scout Mindset", "Julia Galef", 2021),
    B("philosophy", "The Precipice", "Toby Ord", 2020),
    B("philosophy", "The Book of Delights", "Ross Gay", 2019),
    B("philosophy", "The Anthropocene Reviewed", "John Green", 2021),
    B("philosophy", "The Tyranny of Merit", "Michael J. Sandel", 2020),
    B("philosophy", "Noise", "Daniel Kahneman, Olivier Sibony & Cass R. Sunstein", 2021,
      search_author="Kahneman"),
    B("philosophy", "Stolen Focus", "Johann Hari", 2022),
    B("philosophy", "On Tyranny", "Timothy Snyder", 2017),
    # ---------------------------------------------------------------- science
    B("science", "The Gene", "Siddhartha Mukherjee", 2016),
    B("science", "Entangled Life", "Merlin Sheldrake", 2020),
    B("science", "Underland", "Robert Macfarlane", 2019),
    B("science", "The Sixth Extinction", "Elizabeth Kolbert", 2014),
    B("science", "An Immense World", "Ed Yong", 2022, pages=464),
    B("science", "The Hidden Life of Trees", "Peter Wohlleben", 2015, work="OL17711762W"),
    B("science", "Lab Girl", "Hope Jahren", 2016),
    B("science", "The Invention of Nature", "Andrea Wulf", 2015),
    B("science", "Seven Brief Lessons on Physics", "Carlo Rovelli", 2014),
    B("science", "The Vital Question", "Nick Lane", 2015),
    B("science", "H Is for Hawk", "Helen Macdonald", 2014),
    B("science", "Wilding", "Isabella Tree", 2018),
    B("science", "Invisible Women", "Caroline Criado Perez", 2019),
    B("science", "The Code Breaker", "Walter Isaacson", 2021),
    B("science", "Some Assembly Required", "Neil Shubin", 2020),
    # ----------------------------------------------------------------- poetry
    B("poetry", "Citizen", "Claudia Rankine", 2014),
    B("poetry", "Night Sky with Exit Wounds", "Ocean Vuong", 2016),
    B("poetry", "Postcolonial Love Poem", "Natalie Diaz", 2020),
    B("poetry", "Deaf Republic", "Ilya Kaminsky", 2019),
    B("poetry", "Don't Call Us Dead", "Danez Smith", 2017),
    B("poetry", "Wade in the Water", "Tracy K. Smith", 2018),
    B("poetry", "The Carrying", "Ada Limón", 2018),
    B("poetry", "The Tradition", "Jericho Brown", 2019),
    B("poetry", "frank: sonnets", "Diane Seuss", 2021),
    B("poetry", "Hamilton: The Revolution", "Lin-Manuel Miranda & Jeremy McCarter", 2016,
      search_author="Miranda"),
    B("poetry", "Sweat", "Lynn Nottage", 2017),
    B("poetry", "The Inheritance", "Matthew Lopez", 2018),
    B("poetry", "The Hill We Climb", "Amanda Gorman", 2021),
    B("poetry", "Kumukanda", "Kayo Chingonyi", 2017),
    B("poetry", "Pilgrim Bell", "Kaveh Akbar", 2021),
    # --------------------------------------------------------------- children
    B("children", "The Wild Robot", "Peter Brown", 2016),
    B("children", "The Girl Who Drank the Moon", "Kelly Barnhill", 2016),
    B("children", "New Kid", "Jerry Craft", 2019),
    B("children", "The Crossover", "Kwame Alexander", 2014),
    B("children", "Brown Girl Dreaming", "Jacqueline Woodson", 2014),
    B("children", "The Boy, the Mole, the Fox and the Horse", "Charlie Mackesy", 2019),
    B("children", "The Last Cuentista", "Donna Barba Higuera", 2021),
    B("children", "Nevermoor", "Jessica Townsend", 2017),
    B("children", "Pax", "Sara Pennypacker", 2016),
    B("children", "The Explorer", "Katherine Rundell", 2017),
    B("children", "Front Desk", "Kelly Yang", 2018),
    B("children", "When You Trap a Tiger", "Tae Keller", 2020),
    B("children", "Wishtree", "Katherine Applegate", 2017),
    B("children", "Ghost", "Jason Reynolds", 2016),
    B("children", "Echo", "Pam Muñoz Ryan", 2015),
    B("children", "The Inquisitor's Tale", "Adam Gidwitz", 2016),
    # ---------------------------------------------------------------- society
    B("society", "The Dawn of Everything", "David Graeber & David Wengrow", 2021,
      search_author="Graeber"),
    B("society", "Between the World and Me", "Ta-Nehisi Coates", 2015),
    B("society", "Educated", "Tara Westover", 2018),
    B("society", "Say Nothing", "Patrick Radden Keefe", 2018),
    B("society", "Evicted", "Matthew Desmond", 2016),
    B("society", "Born a Crime", "Trevor Noah", 2016),
    B("society", "Caste", "Isabel Wilkerson", 2020),
    B("society", "Bad Blood", "John Carreyrou", 2018),
    B("society", "The Five", "Hallie Rubenhold", 2019),
    B("society", "Chernobyl", "Serhii Plokhy", 2018),
    B("society", "Hidden Figures", "Margot Lee Shetterly", 2016),
    B("society", "Know My Name", "Chanel Miller", 2019),
    B("society", "Stamped from the Beginning", "Ibram X. Kendi", 2016),
    B("society", "Heavy", "Kiese Laymon", 2018),
    B("society", "The Sum of Us", "Heather McGhee", 2021),
]

# Hand-written copy: title -> (tagline, blurb).  Original text; no spoilers.
COPY = {
    # fiction
    "Lincoln in the Bardo": (
        "One night, one grieving father, countless ghosts.",
        "In 1862 the President's young son is laid in a borrowed crypt, and Abraham Lincoln returns "
        "alone after dark to hold him. Around them, a chorus of restless dead argue, joke and confess, "
        "refusing to admit where they are. Saunders builds a novel out of voices, and it lands as a "
        "meditation on grief that is as funny as it is shattering."),
    "The Underground Railroad": (
        "The railroad is real. So is the chase.",
        "Cora, a young woman enslaved on a Georgia cotton plantation, takes a desperate chance on "
        "escape. In Whitehead's reimagining, the Underground Railroad is a literal network of tracks and "
        "tunnels, and each state she surfaces in is its own kind of trap. A propulsive, unflinching "
        "novel about freedom and the country that keeps withholding it."),
    "Hamnet": (
        "A plague summer, a twin, a playwright's grief.",
        "In Stratford in the 1580s, a fiercely independent woman who knows the secrets of plants marries "
        "a Latin tutor with restless ambitions. Years later, while he works in London, sickness reaches "
        "their household. O'Farrell imagines the family behind Shakespeare's most haunting title, with "
        "the mother at the centre of the story."),
    "Normal People": (
        "Two people who keep finding their way back.",
        "In a small Irish town, popular Connell and solitary Marianne begin something secret that neither "
        "can quite explain. Through school, Trinity College and the years after, they drift apart and "
        "back again, misreading each other in ways that feel painfully familiar. A precise, intimate "
        "novel about class, power and how hard it is to say what you mean."),
    "Demon Copperhead": (
        "Appalachia's orphan, telling it straight.",
        "Born in a trailer to a teenage mother in the mountains of southern Virginia, Demon has wit, talent "
        "and almost no luck. Foster care, child labour, football glory and the opioid wave all come at him "
        "in turn. Kingsolver reworks David Copperfield for modern Appalachia in a narrator's voice you "
        "will not forget."),
    "The Overstory": (
        "Nine lives, bound together by trees.",
        "An artist, a soldier, a scientist, a programmer and others each discover, in their own way, that "
        "trees are trying to tell them something. Their paths converge in the fight to save the last old "
        "forests of the American West. A sweeping novel whose real protagonists have roots."),
    "Shuggie Bain": (
        "A boy in Glasgow, loving his mother anyway.",
        "In 1980s Glasgow, as the mines and shipyards close, Agnes Bain clings to glamour and dignity while "
        "drink pulls her under. Her youngest son, Shuggie, a boy who never fits in, is determined to save "
        "her. A tender and devastating debut about poverty, addiction and a love that will not quit."),
    "Klara and the Sun": (
        "An artificial friend, watching and hoping.",
        "From her place in a shop window, Klara, a solar-powered companion, studies the people who pass "
        "and waits to be chosen. When she joins the household of a fragile teenager, she brings a "
        "devotion that is almost religious. Ishiguro's quiet, luminous novel asks what it means to love "
        "someone, and to be human at all."),
    "Small Things Like These": (
        "A coal merchant's Christmas, and a choice.",
        "In a small Irish town in 1985, Bill Furlong delivers coal and timber and keeps his head down, as "
        "most people do. A delivery to the local convent shows him something he cannot unsee. A short, "
        "perfectly made novel about ordinary decency and what it costs."),
    "Homegoing": (
        "Two sisters, two continents, three hundred years.",
        "Half-sisters born in eighteenth-century Ghana never meet: one marries an English officer, the "
        "other is sold into the Atlantic slave trade. Each chapter follows a descendant through the "
        "generations, in Africa and America, down to the present. A bold debut that makes history "
        "feel personal, one life at a time."),
    "Tomorrow, and Tomorrow, and Tomorrow": (
        "Two friends, thirty years, a hundred games.",
        "Sam and Sadie meet as children in a hospital games room, lose touch, and reunite at college with "
        "the idea for a video game. What follows is a partnership that brings fame, rivalry and wounds "
        "neither can name. A novel about creative collaboration and the kind of love that isn't romance."),
    "Prophet Song": (
        "When your own country turns, slowly.",
        "On a dark Dublin evening, two officers of a new secret police come to Eilish Stack's door asking "
        "for her husband. As Ireland slides into authoritarian rule, she fights to hold her four children "
        "and her family together. A breathless, urgent novel of a crisis that feels unnervingly close."),
    "James": (
        "Huck's river journey, told by Jim.",
        "On the run along the Mississippi, the enslaved man Huck Finn calls Jim plays the role white people "
        "expect of him, while thinking, reading and plotting his own way to freedom. Everett hands the "
        "story to the person who was never allowed to tell it. Sharp, funny and furious by turns."),
    "Trust": (
        "One fortune, four versions of the truth.",
        "In the roaring 1920s, a Wall Street tycoon and his reclusive wife become the stuff of legend. A "
        "novel tells their story, then a memoir, then a set of notes, and then a fourth voice that "
        "complicates everything. A puzzle-box about money and the people who get to write history."),
    "Orbital": (
        "Six astronauts, one day, sixteen sunrises.",
        "Aboard the International Space Station, six crew members circle the Earth, watching continents, "
        "storms and seasons roll beneath them. Little happens and everything does. A short, lyrical novel "
        "that makes the whole planet feel like home."),
    "Girl, Woman, Other": (
        "Twelve lives, one sprawling, joyous chorus.",
        "A playwright prepares for her opening night at the National Theatre, and around her move eleven "
        "other women and non-binary people, mostly Black and British, across a century of lives. Their "
        "stories brush against each other in surprising ways. Exuberant, generous and wickedly observant."),
    "Pachinko": (
        "A Korean family's survival, across four generations.",
        "In early twentieth-century Korea, a fisherman's daughter falls for a wealthy stranger, and her "
        "choice sends the family to Japan. There they face prejudice and hardship, scraping out a living "
        "in the pachinko trade. A grand, absorbing saga about home and belonging."),

    # adventure
    "Project Hail Mary": (
        "One astronaut, no memory, a dying sun.",
        "A man wakes aboard a spacecraft light-years from Earth with no idea who he is, and two crewmates "
        "long dead. As memory returns, he realises the survival of humanity depends on him and his "
        "schoolteacher's grasp of science. A problem-solving adventure with a big heart and an unlikely friendship."),
    "Piranesi": (
        "Endless halls, tides, statues, and one devoted explorer.",
        "Piranesi lives in the House, an infinite labyrinth of marble halls where the ocean rises through "
        "the lower floors. He catalogues its statues and tides and meets only one other person, twice a "
        "week, until he finds evidence of someone new. A strange, beautiful puzzle of a novel."),
    "The Fifth Season": (
        "The world ends again. She keeps going.",
        "On a supercontinent wracked by seismic catastrophes, people born with the power to move the earth "
        "are feared, controlled and used. As a new apocalypse begins, a woman sets out across a broken land "
        "after her stolen daughter. The first of a trilogy that won three Hugo Awards in a row."),
    "Children of Time": (
        "Humanity's last ark meets a new civilisation.",
        "A terraforming experiment goes wrong, and on a distant green planet something other than monkeys "
        "inherits an accelerated evolution. Millennia later, the last humans arrive in a battered ship "
        "looking for a home. An epic of first contact told from both sides."),
    "A Memory Called Empire": (
        "A new ambassador. Her predecessor's ghost. Intrigue.",
        "Mahit Dzmare arrives at the heart of the Teixcalaanli Empire to find the previous ambassador from "
        "her small mining station dead, and nobody admitting how. With an outdated copy of his memories in "
        "her head, she has to navigate poetry, politics and a city that wants to swallow her world."),
    "Circe": (
        "A minor goddess finds her own power.",
        "Born to the sun god but scorned in his halls, Circe discovers she has a talent for witchcraft "
        "and is banished to a lonely island. There she crosses paths with gods, monsters and mortals out of "
        "Greek legend. A myth retold from the inside, fierce and humane."),
    "Gideon the Ninth": (
        "Lesbian necromancers, haunted palace, swordplay.",
        "Gideon wants nothing more than to escape the gloomy Ninth House and its bone-witch heir, Harrowhark. "
        "Instead she is drafted as Harrow's cavalier for a deadly trial in a decaying palace by the sea. "
        "Gothic, irreverent and full of swagger, it is a locked-room mystery in space."),
    "The Long Way to a Small, Angry Planet": (
        "A patched-up ship and its found family.",
        "Rosemary joins the Wayfarer, a tunnelling ship with a crew of humans, aliens and one wise AI, "
        "and takes the job of a lifetime: a long haul to a distant, contested world. Along the way the "
        "real adventure is getting to know each other. Warm, generous space opera."),
    "The Wager": (
        "Shipwreck, mutiny, and a battle over the truth.",
        "In 1740 a British warship sails to chase Spanish treasure and is wrecked off the coast of Patagonia. "
        "Months later, two very different bands of survivors return home with very different stories. "
        "Grann reconstructs a true tale of survival, empire and who gets to decide what really happened."),
    "Erebus": (
        "One ship, two poles, a famous disappearance.",
        "HMS Erebus carried Victorian explorers to the edge of Antarctica, then vanished with the Franklin "
        "expedition in the Arctic. Michael Palin follows the ship's whole life, from its launch to the "
        "discovery of its wreck in 2014. A lively, humane portrait of a ship and the people aboard."),
    "Sea of Tranquility": (
        "An anomaly that echoes across five centuries.",
        "An exiled Englishman in a Canadian forest in 1912, a novelist on a book tour centuries later, and "
        "a man raised in a colony on the moon all brush against the same strange moment. Following its "
        "echoes, time itself becomes the puzzle. Elegant, tender speculative fiction."),
    "Babel": (
        "Translation is magic, and magic is power.",
        "Orphaned in Canton and brought to Oxford, Robin Swift trains at the Royal Institute of "
        "Translation, where silver bars inscribed with words power the British Empire. The more he learns, "
        "the more he sees what the magic is for. A dark academic fantasy about language and colonialism."),
    "The Ten Thousand Doors of January": (
        "Doors to other worlds, for those who look.",
        "In the early 1900s, January Scaller grows up in a mansion full of curiosities, the ward of a wealthy "
        "collector. Then she finds a book that tells of doors leading to other worlds. A lush, "
        "adventurous fantasy about stories and the freedom they promise."),
    "All Systems Red": (
        "A security robot who'd rather watch TV.",
        "A security android has hacked its own governor module and could do anything it likes, which "
        "mostly means streaming serials. But when the survey team it guards on a distant planet comes "
        "under attack, it reluctantly decides to care. A funny, sharp novella that launched a beloved series."),
    "Uprooted": (
        "A wizard's tower, a corrupted wood.",
        "Every ten years the wizard called the Dragon takes a girl from the valley to serve in his tower, "
        "and everyone expects him to choose Agnieszka's best friend. On the valley's edge, the Wood waits, "
        "full of malice. A fairy tale with deep Polish roots and real teeth."),
    "Border": (
        "The last edge of Europe, walked slowly.",
        "Kapka Kassabova returns to the forested borderlands where Bulgaria, Greece and Turkey meet, once "
        "a deadly Cold War frontier. She meets smugglers, healers, border guards and refugees, and finds a "
        "landscape thick with ritual and memory. Travel writing of rare depth."),

    # gothic
    "Mexican Gothic": (
        "A mouldering mansion, a family with secrets.",
        "In 1950s Mexico, glamorous Noemí Taboada receives a frantic letter from her newly married cousin "
        "and travels to the remote house of High Place to check on her. Its English owners are cold, the "
        "house is rotting, and something is growing in the walls. A deliciously creepy gothic horror."),
    "The Thursday Murder Club": (
        "Four pensioners, one murder, plenty of cake.",
        "In a peaceful retirement village in Kent, four friends meet weekly to puzzle over unsolved cases. "
        "When a real killing happens on their doorstep, they find they are rather good at this. A cosy, "
        "witty mystery with a surprising amount of heart."),
    "Magpie Murders": (
        "A murder mystery inside a murder mystery.",
        "An editor settles in with the new manuscript from her bestselling crime writer, a classic village "
        "whodunit set in the 1950s. But the final chapters are missing, and the author may have hidden a "
        "real crime in the pages. An ingenious double puzzle for golden-age fans."),
    "The Seven Deaths of Evelyn Hardcastle": (
        "Same day, new body, until he solves it.",
        "At a masquerade party at a crumbling country house, Evelyn Hardcastle will be killed at eleven. "
        "Aiden Bishop must relive the day in the body of a different guest each time until he finds the "
        "murderer. Agatha Christie meets a time loop, with a twist in every chapter."),
    "The Only Good Indians": (
        "One elk hunt. Ten years later, payback.",
        "Four young Blackfeet men break the rules on a hunt and kill something they should not have. A "
        "decade on, something is following them. A horror novel about guilt, identity and tradition, "
        "frightening and deeply moving at once."),
    "Bunny": (
        "An MFA cohort that's sweet, and sinister.",
        "Samantha is a scholarship student at an elite New England writing programme, repelled by the "
        "clique of rich girls who call each other Bunny. Then they invite her to their secret workshop. A "
        "wild, satirical horror story about loneliness and making things up."),
    "The Searcher": (
        "A retired detective. A village that doesn't talk.",
        "Cal Hooper leaves the Chicago police for a quiet life in a run-down cottage in the West of Ireland. "
        "Then a local kid asks him to find a missing brother. French's slow-burning mystery is as much about "
        "a landscape and its silences as about the crime."),
    "Razorblade Tears": (
        "Two ex-con fathers, out for justice.",
        "Ike, a Black man, and Buddy Lee, a white man, have little in common but prison records and the "
        "sons they lost, a married couple murdered in Richmond. Together they set out to find the killers. "
        "A ferocious Southern noir about grief, prejudice and redemption."),
    "My Sister, the Serial Killer": (
        "Bleach, a dead boyfriend, and family loyalty.",
        "In Lagos, Korede is the reliable nurse who always knows how to clean up blood. Her beautiful "
        "younger sister Ayoola keeps killing her boyfriends, and when Ayoola sets her sights on the doctor "
        "Korede loves, something must give. A darkly comic, razor-sharp debut."),
    "His Bloody Project": (
        "1869. A Highland crofter. Three bodies.",
        "In a remote Scottish hamlet, seventeen-year-old Roderick Macrae confesses to a brutal triple "
        "killing. Presented as found documents, his memoir and the trial records leave the reader to weigh "
        "the truth. A literary thriller that was shortlisted for the Booker Prize."),
    "Ninth House": (
        "Yale's secret societies practise real magic.",
        "Alex Stern, a dropout who sees ghosts, is offered a full ride to Yale on one condition: she must "
        "watch over the university's secret societies, whose rituals are dangerously real. When a girl "
        "dies, she suspects the societies know why. Dark academia with a hard edge."),
    "Things We Lost in the Fire": (
        "Buenos Aires stories, unsettling and political.",
        "In these stories, the ordinary streets of Argentina open onto the uncanny: a dirty boy who "
        "vanishes, a haunted hotel, women who set themselves alight. Enriquez blends horror with the "
        "country's memories of violence. Dark, vivid and impossible to shake."),
    "The Appeal": (
        "A murder told in emails and texts.",
        "An amateur dramatic society in a small English town rallies to raise money for a sick child. Then "
        "someone ends up dead. Two law students are given the case file, every message and memo, and "
        "challenged to spot what the police missed."),
    "The Hacienda": (
        "A new bride, a haunted house, a priest.",
        "After Mexico's War of Independence, Beatriz marries a handsome widower and moves to his remote "
        "estate. The house resists her, its walls whisper, and only a young priest believes her. A "
        "romantic, chilling gothic steeped in history."),
    "The Silent Patient": (
        "She shot her husband. Then never spoke.",
        "A celebrated painter is convicted of killing her husband and has not said a word since. A "
        "psychotherapist becomes obsessed with uncovering her motive and gets a post at her secure "
        "hospital. A twisty psychological thriller."),

    # philosophy
    "How to Do Nothing": (
        "Reclaim your attention from the attention economy.",
        "Jenny Odell, an artist in Oakland, argues that doing nothing is not laziness but a form of "
        "resistance to a culture that monetises every waking moment. Drawing on birdwatching, art and "
        "philosophy, she suggests ways to pay attention to the places and people around us."),
    "Four Thousand Weeks": (
        "Time management for actual mortals.",
        "The average human life lasts about four thousand weeks, and no productivity system will make it "
        "longer. Oliver Burkeman argues that accepting our limits is the start of using time well. Wise, "
        "funny and liberating, it is a self-help book that takes philosophy seriously."),
    "Trick Mirror": (
        "Nine essays on self-delusion online and off.",
        "Jia Tolentino examines the forces that shape how we see ourselves: the internet, scams, "
        "weddings, athleisure and reality television. Personal and analytical at once, these essays "
        "probe the cultural contradictions we all live with. A defining voice of her generation."),
    "The Argonauts": (
        "Love, family and theory, entwined.",
        "Maggie Nelson writes about falling in love with the artist Harry Dodge, her pregnancy, and the "
        "family they build. She weaves memoir with critical theory, testing ideas about gender, queerness "
        "and care against lived life. A genre-defying book of intellectual daring."),
    "Being Mortal": (
        "What matters most, in the end.",
        "A surgeon confronts how modern medicine handles ageing and dying, and how often it fails the "
        "people it treats. Gawande tells the stories of patients and of his own father. A humane, "
        "clarifying book about how to live well to the very end."),
    "At the Existentialist Café": (
        "Freedom, being, and apricot cocktails.",
        "In 1933, three friends in a Paris bar discuss a new philosophy over cocktails, and existentialism "
        "is born. Bakewell tells the story of Sartre, de Beauvoir, Heidegger, Camus and their circle, "
        "their ideas and their quarrels. An irresistible group portrait of a philosophical movement."),
    "Metaphysical Animals": (
        "Four women who brought philosophy back to life.",
        "At wartime Oxford, Elizabeth Anscombe, Philippa Foot, Mary Midgley and Iris Murdoch met while "
        "most of the men were away. Together they challenged a philosophy that had stopped asking how to "
        "live. A lively group biography of friendship and ideas."),
    "The Scout Mindset": (
        "Seeing what's there, not what you want.",
        "Julia Galef contrasts two mental stances: the soldier, who defends beliefs, and the scout, who "
        "wants to see the territory clearly. She explains why the scout mindset is rarer than we think "
        "and how to cultivate it. Practical, upbeat and full of good examples."),
    "The Precipice": (
        "Humanity's long future, and how to protect it.",
        "An Oxford philosopher surveys the risks that could end our story: from asteroids and supervolcanoes "
        "to engineered pandemics and unaligned AI. Toby Ord estimates the odds and argues for safeguarding "
        "the vast future we might have. Sobering but ultimately hopeful."),
    "The Book of Delights": (
        "A year of small essays on joy.",
        "For one year, the poet Ross Gay set out to write a short essay each day about something "
        "delightful. The results range from fig trees and high-fives to grief and racism. A warm, "
        "generous collection about paying attention to what sustains us."),
    "The Anthropocene Reviewed": (
        "Our planet, reviewed on a five-star scale.",
        "John Green reviews facets of the human-centred world, from Canada geese and air conditioning to "
        "the internet and the QWERTY keyboard. Each essay winds into reflection on wonder, illness and "
        "hope. Funny, personal and surprisingly profound."),
    "The Tyranny of Merit": (
        "What's become of the common good?",
        "Political philosopher Michael Sandel asks why winners in a meritocracy feel they deserve their "
        "success, and what that does to everyone else. He traces how this belief fuels resentment and "
        "polarisation. A provocative argument for the dignity of work."),
    "Noise": (
        "The hidden error in human judgement.",
        "Two doctors given the same case, or two judges given the same crime, often reach very different "
        "conclusions. Kahneman, Sibony and Sunstein call this variability noise and show how much it costs. "
        "A practical guide to making better decisions."),
    "Stolen Focus": (
        "Why can't we pay attention anymore?",
        "Johann Hari investigates why concentration seems to be collapsing and finds causes beyond our "
        "phones, from sleep and diet to the design of the attention economy. He argues for collective as "
        "well as personal solutions."),
    "On Tyranny": (
        "Twenty lessons for defending democracy.",
        "A historian of twentieth-century Europe distils what that era teaches about how democracies "
        "fall. Timothy Snyder offers twenty short, practical lessons, from defending institutions to "
        "believing in truth. A slim book with a lasting charge."),

    # science
    "The Gene": (
        "The story of heredity, intimate and vast.",
        "Siddhartha Mukherjee traces the gene from Mendel's peas and Darwin's finches to genome editing, "
        "interleaving the science with his own family's history of mental illness. A sweeping, humane "
        "history of one of the most powerful ideas in science."),
    "Entangled Life": (
        "Fungi made the world. Still running it.",
        "Fungi are everywhere, in soil, air and our own bodies, yet we barely know them. Merlin Sheldrake "
        "introduces mycelial networks that link forests, yeasts that shaped civilisation, and moulds that "
        "solve puzzles. A mind-expanding tour of a hidden kingdom."),
    "Underland": (
        "A journey into the world beneath our feet.",
        "Robert Macfarlane descends into caves, catacombs, mines and glacier shafts, and to a nuclear waste "
        "vault built to last a hundred thousand years. Along the way he considers deep time and what we "
        "leave to the future. Nature writing at its most ambitious."),
    "The Sixth Extinction": (
        "Watching an extinction, as it happens.",
        "Elizabeth Kolbert travels from the Andes to the Great Barrier Reef to report on species "
        "disappearing in our lifetimes. Through frogs, bats and rhinos, she argues that humans are driving a "
        "mass extinction as dramatic as any in Earth's history."),
    "An Immense World": (
        "Every animal lives inside a different reality.",
        "Ed Yong explores how animals perceive the world: the electric sense of fish, the ultraviolet "
        "vision of birds, the magnetic sense of turtles. Each creature lives in its own sensory bubble. A "
        "joyful book that makes the familiar feel strange."),
    "The Hidden Life of Trees": (
        "Forests talk, share, and remember.",
        "A German forester describes how trees communicate through their roots and fungal networks, care "
        "for their young and warn each other of danger. Peter Wohlleben's walk in the woods changes how "
        "you see every forest. Gentle, curious and full of wonder."),
    "Lab Girl": (
        "A scientist's life, rooted in plants.",
        "Hope Jahren grew up in a cold Minnesota town and found her calling in the laboratory. She tells "
        "the story of her career, her friendship with her lab partner Bill, and the lives of plants and "
        "trees. A memoir of science as love and as work."),
    "The Invention of Nature": (
        "The explorer who taught us nature is connected.",
        "Alexander von Humboldt climbed volcanoes, mapped rivers and saw nature as an interconnected web "
        "of life. Andrea Wulf reveals how his ideas inspired Darwin, Thoreau and modern environmentalism. "
        "A vivid biography of a forgotten giant."),
    "Seven Brief Lessons on Physics": (
        "The universe, in under a hundred pages.",
        "In seven short lessons, Carlo Rovelli explains general relativity, quantum mechanics, black holes "
        "and the place of humans in the cosmos. Clear and poetic, the book opens the deepest ideas of "
        "physics to anyone curious."),
    "The Vital Question": (
        "Why life looks the way it does.",
        "Biochemist Nick Lane argues that energy holds the key to the origin of life and the evolution "
        "of complex cells. From hydrothermal vents to sex and death, he builds a bold theory. A demanding, "
        "exhilarating read for anyone curious about life's beginnings."),
    "H Is for Hawk": (
        "Grief, a goshawk, and learning to live.",
        "After her father's sudden death, Helen Macdonald takes on the training of a goshawk, among the "
        "most difficult of birds. As she retreats into the hawk's wild world, she also traces the troubled "
        "life of the writer T. H. White. A remarkable blend of memoir and nature writing."),
    "Wilding": (
        "A farm handed back to nature.",
        "When their intensive farm in Sussex was failing, Isabella Tree and her husband let it run wild. "
        "Longhorn cattle, pigs and ponies roamed free, and rare birds and butterflies returned. An inspiring "
        "account of rewilding in practice."),
    "Invisible Women": (
        "A world built for men, measured.",
        "From car crash tests to medical trials and office temperatures, data on human beings has "
        "defaulted to men. Caroline Criado Perez shows how this gap shapes women's lives, health and "
        "safety. An eye-opening, rigorously argued book."),
    "The Code Breaker": (
        "CRISPR and the race to edit life.",
        "Walter Isaacson follows Jennifer Doudna and her rivals in the race to develop CRISPR, the gene "
        "editing tool. He explores the promise and ethical questions of rewriting our own DNA. A science "
        "story with the pace of a thriller."),
    "Some Assembly Required": (
        "Four billion years of evolutionary tinkering.",
        "Neil Shubin, discoverer of the fish with legs, explains how evolution repurposes old genes and "
        "structures for new uses. From fins to fingers, life's history is a story of borrowing. An "
        "accessible tour of the genome's surprises."),

    # poetry
    "Citizen": (
        "Everyday racism, in lyric fragments.",
        "Through poems, prose and images, Claudia Rankine records the small, constant aggressions that "
        "accumulate in the life of a Black American, from tennis courts to the checkout line. A book that "
        "invents its own form to make the reader feel what it describes."),
    "Night Sky with Exit Wounds": (
        "Family, war and desire, in luminous lines.",
        "Ocean Vuong's debut collection moves between the Vietnam War, his family's journey to America and "
        "a young man's coming of age. Tender and fierce, the poems find beauty in the hardest places. "
        "Winner of the T. S. Eliot Prize."),
    "Postcolonial Love Poem": (
        "Love poems as acts of resistance.",
        "Natalie Diaz writes of desire, water, language and the bodies of Native people in America. Her "
        "poems are sensuous and urgent, insisting on the right to love and to live on the land. Winner of "
        "the Pulitzer Prize for Poetry."),
    "Deaf Republic": (
        "A town falls silent, and resists.",
        "When soldiers shoot a deaf boy during a protest in an occupied town, the people stop hearing, and "
        "communicate in sign. Ilya Kaminsky tells their story in a sequence of poems like a play. A "
        "haunting fable of resistance and tenderness."),
    "Don't Call Us Dead": (
        "An afterlife where Black boys are safe.",
        "Danez Smith opens with an imagined heaven for Black men killed by police, then turns to "
        "desire, HIV and the nation's violence. The poems blaze with anger, grief and joy. Winner of the "
        "Forward Prize for Best Collection."),
    "Wade in the Water": (
        "America's voices, past and present.",
        "Tracy K. Smith weaves letters from Black soldiers of the Civil War, the Declaration of Independence "
        "and voices from today into poems about history, faith and motherhood. Quiet, searching and "
        "politically powerful."),
    "The Carrying": (
        "What we carry, what carries us.",
        "Ada Limón writes of horses, fertility, a failing body and the beauty of the world in hard times. "
        "Her poems are direct and tender, finding consolation in close attention. Winner of the National "
        "Book Critics Circle Award."),
    "The Tradition": (
        "Beauty and threat, in the same breath.",
        "Jericho Brown's poems look at the Black body, queer love and the ever-present threat of violence. "
        "He invents a new form, the duplex, to hold their contradictions. Winner of the Pulitzer Prize for Poetry."),
    "frank: sonnets": (
        "A life, unflinching, in sonnets.",
        "Diane Seuss tells her story through a sequence of sonnets: growing up in rural Michigan, addiction, "
        "motherhood, art and loss. The poems are funny, raw and formally restless. Winner of the Pulitzer Prize for Poetry."),
    "Hamilton: The Revolution": (
        "The full libretto, plus the story.",
        "The complete text of Lin-Manuel Miranda's hit musical, annotated by the composer himself, "
        "alongside an account of how the show came to be. A behind-the-scenes look at the making of a "
        "cultural phenomenon."),
    "Sweat": (
        "A factory town's friendships, coming apart.",
        "In a Reading, Pennsylvania bar, workers from the local steel tubing plant drink, celebrate and "
        "argue. As layoffs loom, loyalties crack. Lynn Nottage's Pulitzer-winning play captures the human "
        "cost of deindustrialisation."),
    "The Inheritance": (
        "Gay New York, haunted by history.",
        "Inspired by E. M. Forster's Howards End, Matthew Lopez's two-part play follows young gay men in "
        "contemporary New York and their relationship with the generation that lived through the AIDS "
        "crisis. An epic of love and legacy."),
    "The Hill We Climb": (
        "An inaugural poem for a wounded nation.",
        "Amanda Gorman delivered this poem at the 2021 presidential inauguration, at twenty-two the youngest "
        "inaugural poet in American history. Its call for unity and hope resonated worldwide. A keepsake edition."),
    "Kumukanda": (
        "Belonging, masculinity, and a Zambian heritage.",
        "Kayo Chingonyi, born in Zambia and raised in England, writes about being a young Black man in "
        "Britain, his family and the music that shaped him. Rhythmic and assured. Winner of the Dylan "
        "Thomas Prize."),
    "Pilgrim Bell": (
        "Prayer, silence, and recovery.",
        "Kaveh Akbar writes poems of faith and doubt, sobriety, language and Iranian-American identity. "
        "Sparse and spiritual, they listen for meaning in silence. A luminous second collection."),

    # children
    "The Wild Robot": (
        "A robot learns to live with nature.",
        "After a shipwreck, a robot named Roz washes up on a remote island with no idea how she got there. "
        "To survive, she must learn from the animals, and slowly she becomes part of their world. A gentle, "
        "funny adventure about kindness and belonging."),
    "The Girl Who Drank the Moon": (
        "A witch, a baby, accidental magic.",
        "Every year the people of the Protectorate leave a baby in the forest for the witch. But Xan, the "
        "witch, is kind and carries the babies to new homes, until one year she accidentally feeds one "
        "moonlight and fills her with magic. A Newbery-winning fairy tale."),
    "New Kid": (
        "New school, new rules, same Jordan.",
        "Seventh-grader Jordan Banks loves drawing cartoons but is sent to a prestigious private school "
        "where he is one of the few kids of colour. Navigating two worlds, he finds his way with humour. "
        "The first graphic novel to win the Newbery Medal."),
    "The Crossover": (
        "Twin brothers, basketball, poetry in motion.",
        "Josh and Jordan Bell are twin basketball stars, but their bond is tested on and off the court. "
        "Told in vivid verse that bounces like a ball, this is a story about family and growing up. "
        "Winner of the Newbery Medal."),
    "Brown Girl Dreaming": (
        "A childhood told in poems.",
        "Jacqueline Woodson recalls growing up in the 1960s and 70s, between South Carolina and Brooklyn, "
        "in the shadow of Jim Crow and the civil rights movement. Each poem is a memory of becoming a "
        "writer. Winner of the National Book Award."),
    "The Boy, the Mole, the Fox and the Horse": (
        "Four friends, and the courage to ask.",
        "A boy, a mole, a fox and a horse wander through the countryside together, talking about kindness, "
        "fear and friendship. Charlie Mackesy's ink drawings and handwritten words have comforted readers of "
        "all ages."),
    "The Last Cuentista": (
        "The last storyteller, on the last ship.",
        "When a comet destroys Earth, Petra Peña and her family flee on a spaceship. Centuries later she "
        "wakes to find that the ship's new rulers have erased humanity's memories, and only she remembers "
        "the stories her grandmother told. Winner of the Newbery Medal."),
    "Nevermoor": (
        "A cursed girl finds a magical city.",
        "Morrigan Crow is cursed to die on her eleventh birthday, but at midnight she is whisked away to "
        "the magical city of Nevermoor. To stay, she must pass trials for a mysterious society. A whimsical "
        "adventure full of delights."),
    "Pax": (
        "A boy and his fox, separated by war.",
        "Peter rescued Pax when he was a kit, but when war comes and his father enlists, Peter is forced to "
        "abandon him. Both boy and fox set out on a journey to find each other. A moving story about loyalty."),
    "The Explorer": (
        "Stranded children survive the Amazon.",
        "After a plane crash in the Amazon jungle, four children must work together to survive. When they "
        "discover a ruined city hidden in the forest, they find they are not quite alone. A thrilling "
        "adventure about courage and wonder that won the Costa Children's Book Award."),
    "Front Desk": (
        "A motel, a family, a girl's courage.",
        "Ten-year-old Mia Tang and her immigrant parents manage a motel in California for a ruthless owner. "
        "While her parents secretly hide immigrants, Mia runs the front desk. A heartfelt story about "
        "family and standing up for what's right."),
    "When You Trap a Tiger": (
        "Grandmother's stories come to life.",
        "When Lily and her family move in with her sick grandmother, a magical tiger appears, promising "
        "to heal Halmoni in return for stolen stories. A moving tale of family, folklore and courage. "
        "Winner of the Newbery Medal."),
    "Wishtree": (
        "An old oak tells its story.",
        "Red is a two-hundred-year-old oak tree, and every year people tie wishes to its branches. When a "
        "new family moves in and faces hostility, Red decides to help. A gentle story about friendship and "
        "community."),
    "Ghost": (
        "A boy who runs from everything.",
        "Castle Cranshaw, known as Ghost, has been running since his father fired a gun at him. When he "
        "joins an elite track team, he must learn to run for something. A funny, heartfelt story."),
    "Echo": (
        "One harmonica, three children, three countries.",
        "A harmonica passes through the hands of three children in Germany, Pennsylvania and California in the "
        "1930s and 40s, carrying a melody that connects them across time. A sweeping story of hope."),
    "The Inquisitor's Tale": (
        "Three magical children, medieval France.",
        "In 1242, travellers at an inn swap stories about three children with miraculous powers and their "
        "loyal dog. A funny, wise adventure about friendship and tolerance."),

    # society
    "The Dawn of Everything": (
        "Human history was never one straight line.",
        "An anthropologist and an archaeologist challenge the story that humans moved inevitably from "
        "small egalitarian bands to cities, kings and states. Drawing on new evidence, they show our "
        "ancestors experimented with many ways of living together. A bold rethink of the human past."),
    "Between the World and Me": (
        "A letter from father to son.",
        "Written as a letter to his teenage son, Ta-Nehisi Coates reflects on what it means to inhabit a "
        "Black body in America. Drawing on history and his own life, he confronts the nation's past and "
        "present. A profound, essential book."),
    "Educated": (
        "A survivalist childhood, then the classroom.",
        "Tara Westover grew up in the Idaho mountains with survivalist parents who distrusted schools and "
        "hospitals. She first set foot in a classroom at seventeen. Her memoir traces an extraordinary "
        "journey of self-invention."),
    "Say Nothing": (
        "A disappearance, and the Troubles.",
        "In 1972, Jean McConville, a widowed mother of ten, was taken from her Belfast home by masked "
        "intruders. Patrick Radden Keefe uses her case to explore Northern Ireland's conflict and its "
        "legacy. Gripping narrative history."),
    "Evicted": (
        "Housing, poverty and profit in America.",
        "Matthew Desmond follows eight families in Milwaukee struggling to keep a roof over their heads, "
        "and the landlords who profit from them. He shows that eviction is a cause, not only a "
        "consequence, of poverty. Winner of the Pulitzer Prize."),
    "Born a Crime": (
        "Growing up mixed-race under apartheid.",
        "Trevor Noah was born to a Black mother and a white father at a time when their union was illegal "
        "in South Africa. His memoir is hilarious and harrowing, and a love letter to his fearless mother."),
    "Caste": (
        "The hidden hierarchy underneath American life.",
        "Isabel Wilkerson argues that America has a caste system, a rigid hierarchy that has endured "
        "since slavery. She compares it to India and Nazi Germany and shows its human cost. A powerful "
        "and illuminating book."),
    "Bad Blood": (
        "A Silicon Valley startup built on lies.",
        "Theranos promised to revolutionise blood testing with a single drop, and its founder became a "
        "billionaire. John Carreyrou, the journalist who exposed the fraud, tells the full story. A "
        "page-turning account of hubris and deception."),
    "The Five": (
        "The forgotten lives of Jack the Ripper's victims.",
        "Hallie Rubenhold tells the stories of the five women killed in Whitechapel in 1888, restoring "
        "their lives and challenging the myths that have reduced them to victims. A powerful work of social history."),
    "Chernobyl": (
        "The nuclear disaster, and the Soviet state.",
        "Serhii Plokhy tells the story of the 1986 Chernobyl disaster, from the night of the explosion to "
        "its political aftermath. He shows how the accident exposed the failings of the Soviet system."),
    "Hidden Figures": (
        "The Black women who calculated the space race.",
        "During the space race, a group of Black women mathematicians at NASA calculated the trajectories "
        "that sent astronauts into orbit. Margot Lee Shetterly brings their extraordinary story to light."),
    "Know My Name": (
        "A survivor reclaims her story.",
        "Known to the world as Emily Doe, Chanel Miller was sexually assaulted on the Stanford campus. In "
        "this memoir she reclaims her identity and tells her story in her own words. A powerful indictment "
        "of a system that fails survivors."),
    "Stamped from the Beginning": (
        "The history of racist ideas in America.",
        "Ibram X. Kendi traces racist ideas through the lives of five Americans, from Cotton Mather to "
        "Angela Davis. He shows how these ideas have been used to justify inequality. Winner of the "
        "National Book Award."),
    "Heavy": (
        "A memoir of body, family and America.",
        "Kiese Laymon writes to his mother about growing up Black in Mississippi, his body, addiction, "
        "violence and the lies the nation tells. An honest, searching memoir."),
    "The Sum of Us": (
        "What racism costs everyone.",
        "Heather McGhee argues that racism hurts not only people of colour but white people too, by "
        "undermining public goods. She makes the case for solidarity and shared prosperity."),
}

for _b in BOOKS:
    if not _b["tagline"] and _b["title"] in COPY:
        _b["tagline"], _b["blurb"] = COPY[_b["title"]]


# ==========================================================================
# HTTP with cache and per-host throttle
# ==========================================================================

_last = {}


class QuotaExceeded(Exception):
    """A daily quota is exhausted; retrying today is pointless."""


def _cache_path(url, ext):
    host = urllib.parse.urlsplit(url).netloc.replace(":", "_")
    h = hashlib.sha1(url.encode()).hexdigest()[:20]
    d = os.path.join(CACHE, host)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, h + ext)


def _request(url):
    """GET `url` politely; return (status, bytes).  404/400 return status without raising."""
    host = urllib.parse.urlsplit(url).netloc
    backoff = 10
    for attempt in range(6):
        wait = DELAY - (time.time() - _last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 400, 410):
                return e.code, b""
            if e.code == 429:
                body = e.read().decode("utf-8", "replace")
                if "per day" in body.lower():
                    raise QuotaExceeded(f"{host}: daily quota exhausted")
            if e.code in (429, 500, 502, 503, 504):
                ra = e.headers.get("Retry-After") if e.headers else None
                delay = int(ra) if ra and ra.isdigit() else backoff
                print(f"    {e.code} from {host}; sleeping {delay}s", file=sys.stderr)
                time.sleep(delay)
                backoff = min(backoff * 2, 300)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            print(f"    network error {e} for {url}; retrying", file=sys.stderr)
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)
    raise RuntimeError(f"giving up on {url}")


def get_json(url, raw=False):
    """JSON (or text, with raw=True) from cache or network; None for a 404.
    Errors are not cached."""
    path = _cache_path(url, ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)["body"]
    status, data = _request(url)
    body = None
    if status == 200:
        text = data.decode("utf-8")
        body = text if raw else json.loads(text)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"url": url, "status": status, "body": body}, f)
    return body


def image_size(data):
    """(width, height) of a JPEG/PNG/GIF byte string, or None."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return struct.unpack("<HH", data[6:10])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
                i += 1 if marker == 0xFF else 2
                continue
            seg = struct.unpack(">H", data[i + 2:i + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            i += 2 + seg
    return None


def cover_info(cover_id):
    """{'status', 'width', 'height'} for an Open Library cover id (cached)."""
    url = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg?default=false"
    path = _cache_path(url, ".meta.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    status, data = _request(url)
    size = image_size(data) if status == 200 else None
    info = {"url": url, "status": status, "bytes": len(data),
            "width": size[0] if size else 0, "height": size[1] if size else 0}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(info, f)
    return info


# ==========================================================================
# Matching helpers
# ==========================================================================

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"^(the|a|an) ", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()


def main_title(t):
    return norm(re.split(r"[:;(]", t)[0])


def title_ok(want, got):
    w, g = main_title(want), norm(got)
    return bool(w) and (g == w or g.startswith(w + " ") or main_title(got) == w)


def surname(author):
    first = re.split(r",| & | and ", author)[0].strip()
    return norm(first.split()[-1])


def author_ok(book, names):
    """The surname (or search_author) must appear in an author name; so must the
    first given name when it is a full word, to reject namesakes (Smith, Brown)."""
    if book.get("search_author"):
        keys = [norm(book["search_author"])]
    else:
        first = norm(re.split(r",| & | and ", book["author"])[0]).split()
        keys = [first[-1]] + ([first[0]] if len(first) > 1 and len(first[0]) > 1 else [])
    return any(all(re.search(rf"\b{re.escape(k)}\b", norm(n)) for k in keys) for n in names or [])


BAD_PUB = re.compile(r"thorndike|wheeler|large print|center point|book club|bolinda|"
                     r"recorded books|audible|brilliance|blackstone|tantor|dreamscape|"
                     r"turtleback|perfection learning|paw prints|scholastic book clubs|harperluxe|"
                     r"diversified publishing|random house large|alfred music",
                     re.I)


# ISBN registration groups of the English-language area: 978-0, 978-1, 979-8 (US).
ENGLISH_ISBN = re.compile(r"(9780|9781|9798)\d{9}")


def english_isbns(ed):
    return [i for i in (x.replace("-", "") for x in ed.get("isbn_13", [])) if ENGLISH_ISBN.fullmatch(i)]


def edition_score(ed, book):
    """Higher is better.  None means unusable (not an English print ISBN-13 edition
    of this title, published no earlier than the book's first year)."""
    if not english_isbns(ed):
        return None
    if not title_ok(book["title"], ed.get("title", "")):
        return None
    m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", ed.get("publish_date") or "")
    if m and int(m.group(1)) < book["year"] - 1:
        return None
    langs = [l.get("key", "") for l in ed.get("languages", [])]
    if langs and "/languages/eng" not in langs:
        return None
    fmt = (ed.get("physical_format") or "").lower()
    if any(x in fmt for x in ("audio", "cd", "mp3", "ebook", "e-book", "electronic", "kindle", "digital")):
        return None
    pubs = " ".join(ed.get("publishers", []))
    text = pubs + " " + fmt + " " + (ed.get("edition_name") or "") + " " + (ed.get("title") or "")
    if BAD_PUB.search(text):
        return None
    score = 0
    if langs:
        score += 2
    if "paperback" in fmt or "trade" in fmt:
        score += 4
    elif "hardcover" in fmt or "hardback" in fmt:
        score += 3
    elif "mass market" in fmt:
        score += 1
    if ed.get("covers") and any(c and c > 0 for c in ed["covers"]):
        score += 5
    if ed.get("number_of_pages"):
        score += 1
    if re.search(r"spanish|edici|deutsch|fran", text, re.I):
        return None
    return score


# ==========================================================================
# Verification of one candidate
# ==========================================================================

def find_work(book):
    if book.get("work"):
        w = get_json(f"https://openlibrary.org/works/{book['work']}.json")
        return ([{"key": f"/works/{book['work']}", "title": w["title"], "author_name": [book["author"]],
                  "first_publish_year": None, "number_of_pages_median": None}] if w else [])
    q = urllib.parse.urlencode({
        "title": book.get("search_title", book["title"]),
        "author": book.get("search_author", surname(book["author"])),
        "fields": "key,title,author_name,first_publish_year,number_of_pages_median,cover_i,edition_count,language",
        "limit": 10})
    docs = (get_json(f"https://openlibrary.org/search.json?{q}") or {}).get("docs", [])
    docs = [d for d in docs if title_ok(book["title"], d.get("title", "")) and author_ok(book, d.get("author_name"))]
    if not docs:
        # The title= field misses some works (e.g. leading articles); try free text.
        q = urllib.parse.urlencode({
            "q": f"{main_title(book.get('search_title', book['title']))} {book.get('search_author', surname(book['author']))}",
            "fields": "key,title,author_name,first_publish_year,number_of_pages_median,cover_i,edition_count,language",
            "limit": 10})
        docs = (get_json(f"https://openlibrary.org/search.json?{q}") or {}).get("docs", [])
        docs = [d for d in docs if title_ok(book["title"], d.get("title", "")) and author_ok(book, d.get("author_name"))]
    if not docs:
        return None
    docs.sort(key=lambda d: -(d.get("edition_count") or 0))
    return docs[:3]


_v1_quota = [True]


def google_lookup(isbn):
    """Google Books volume for `isbn` as {id, title, pageCount, embeddable, viewability}.

    Uses the Books API v1 (key from $GOOGLE_BOOKS_API_KEY if set).  The keyless
    v1 quota is often exhausted; then the same Google Books volume data is read
    from the Books Data API Atom feed (books.google.com/books/feeds/volumes),
    which reports the same id, title, page count, embeddability and viewability.
    """
    if _v1_quota[0]:
        key = os.environ.get("GOOGLE_BOOKS_API_KEY")
        url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}"
        try:
            res = get_json(url + (f"&key={key}" if key else "")) or {}
            items = res.get("items") or []
            if not items:
                return None
            vi, ai = items[0].get("volumeInfo", {}), items[0].get("accessInfo", {})
            return {"id": items[0]["id"], "title": vi.get("title", ""), "pageCount": vi.get("pageCount"),
                    "embeddable": bool(ai.get("embeddable")), "viewability": ai.get("viewability")}
        except QuotaExceeded as e:
            print(f"    {e}; using the Google Books Atom feed instead", file=sys.stderr)
            _v1_quota[0] = False
    xml = get_json(f"https://books.google.com/books/feeds/volumes?q=isbn:{isbn}", raw=True)
    if not xml:
        return None
    m = re.search(r"<entry>(.*?)</entry>", xml, re.S)
    if not m:
        return None
    e = m.group(1)
    vid = re.search(r"<id>[^<]*/volumes/([^<]+)</id>", e)
    title = re.search(r"<title[^>]*>([^<]*)</title>", e)
    pages = re.search(r"<dc:format>(\d+) pages</dc:format>", e)
    emb = re.search(r"<gbs:embeddability value='[^#]*#([a-z_]+)'", e)
    view = re.search(r"<gbs:viewability value='[^#]*#([a-z_]+)'", e)
    viewmap = {"view_all_pages": "ALL_PAGES", "view_partial": "PARTIAL", "view_no_pages": "NO_PAGES"}
    return {"id": vid.group(1) if vid else None,
            "title": html_unescape(title.group(1)) if title else "",
            "pageCount": int(pages.group(1)) if pages else None,
            "embeddable": bool(emb) and emb.group(1) == "embeddable",
            "viewability": viewmap.get(view.group(1) if view else "", "UNKNOWN")}


def html_unescape(s):
    return html.unescape(s)


def verify(book, log):
    """Return a catalogue record for `book`, or None (with reasons in `log`).
    Tries the matching Open Library works in order of edition count."""
    works = find_work(book)
    if not works:
        log.append("no matching Open Library work")
        return None
    for work in works:
        rec = verify_work(book, work, log)
        if rec:
            return rec
    return None


def verify_work(book, work, log):
    wid = work["key"].split("/")[-1]
    fpy = work.get("first_publish_year")
    if fpy and fpy < book["year"] - 1:
        log.append(f"note: OL first_publish_year {fpy} vs curated {book['year']}")
    if not (YEARS[0] <= book["year"] <= YEARS[1]):
        log.append(f"year {book['year']} out of range")
        return None

    eds = (get_json(f"https://openlibrary.org/works/{wid}/editions.json?limit=500") or {}).get("entries", [])
    if book.get("isbn"):
        cands = [e for e in eds if book["isbn"] in [i.replace("-", "") for i in e.get("isbn_13", [])]]
        if not cands:
            ed = get_json(f"https://openlibrary.org/isbn/{book['isbn']}.json")
            cands = [ed] if ed else []
        ranked = [(99, e) for e in cands]
    else:
        ranked = sorted(((s, e) for e in eds if (s := edition_score(e, book)) is not None),
                        key=lambda t: -t[0])
    if not ranked:
        log.append(f"{wid}: no English print ISBN-13 edition among {len(eds)} editions")
        return None

    # Cover candidates: the chosen edition's covers first, then other English editions'.
    def good_cover(cid):
        if not cid or cid <= 0:
            return False
        info = cover_info(cid)
        return info["status"] == 200 and info["width"] >= MIN_COVER_WIDTH

    chosen = None
    tried = 0
    for score, ed in ranked:
        if tried >= 6:
            break
        tried += 1
        isbn = book.get("isbn") or english_isbns(ed)[0]
        # ISBN must resolve on Open Library to this work.
        ol = get_json(f"https://openlibrary.org/isbn/{isbn}.json")
        ol_ok = bool(ol) and any(w.get("key") == f"/works/{wid}" for w in ol.get("works", []))
        g = google_lookup(isbn)
        g_ok = bool(g) and bool(g["id"]) and title_ok(book["title"], g["title"])
        if g and not g_ok:
            log.append(f"isbn {isbn}: Google title {g['title']!r} mismatched")
            g = None
        if not (ol_ok or g_ok):
            log.append(f"isbn {isbn}: resolves nowhere to this title")
            continue
        cid = next((c for c in ed.get("covers", []) if good_cover(c)), None)
        chosen = (isbn, ed, g, cid)
        if cid:
            break
    if not chosen:
        log.append("no edition verified")
        return None
    isbn, ed, g, cid = chosen
    if not cid:
        # Fall back to another English edition's cover, then the work's own covers.
        for _, other in ranked[:15]:
            cid = next((c for c in other.get("covers", []) if good_cover(c)), None)
            if cid:
                break
    if not cid:
        # The work's own covers, minus any that belong to excluded editions
        # (large print, audio, translations...).
        banned = {c for e in eds if edition_score(e, book) is None for c in e.get("covers", [])}
        w = get_json(f"https://openlibrary.org/works/{wid}.json") or {}
        cid = next((c for c in w.get("covers", []) if c not in banned and good_cover(c)), None)
    if not cid:
        log.append("no verified cover")
        return None

    pages = ed.get("number_of_pages") or work.get("number_of_pages_median") or (g or {}).get("pageCount")
    if not pages or pages < 16:
        pages = book.get("pages") or 300
        log.append(f"pages estimated: {pages}")
    preview = bool(g) and g["embeddable"] and g["viewability"] in ("PARTIAL", "ALL_PAGES")
    return {
        "id": f"ol-{wid}", "title": book["title"], "author": book["author"], "year": book["year"],
        "section": book["section"], "isbn13": isbn, "cover_id": cid, "pages": int(pages),
        "google_id": g["id"] if g else None, "preview": preview,
        "tagline": book["tagline"], "blurb": book["blurb"], "modern": True,
    }


# ==========================================================================
# Build
# ==========================================================================

def check_copy(book):
    errs = []
    if not book["tagline"] or len(book["tagline"].split()) > 8:
        errs.append("tagline missing or over 8 words")
    n = len(re.findall(r"(?<!\b[A-Z])[.!?](?:\s|$)", book["blurb"]))
    if not (2 <= n <= 3):
        errs.append(f"blurb has {n} sentences")
    return errs


def main(argv):
    check = "--check" in argv
    only = [a for a in argv if not a.startswith("--")]
    authors = {}
    for b in BOOKS:
        s = norm(b["author"])
        if s in authors:
            sys.exit(f"duplicate author {s}: {authors[s]} / {b['title']}")
        authors[s] = b["title"]

    records, problems = [], []
    for sec in SECTIONS:
        n = 0
        for book in (b for b in BOOKS if b["section"] == sec["key"]):
            if only and book["title"] not in only:
                continue
            if not check and n >= PER_SECTION:
                break
            if not check and check_copy(book):
                problems.append(f"{book['title']}: {'; '.join(check_copy(book))} (skipped)")
                continue
            log = []
            rec = verify(book, log)
            status = "OK  " if rec else "DROP"
            extra = (f"{rec['id']} isbn {rec['isbn13']} cover {rec['cover_id']} pages {rec['pages']} "
                     f"google {rec['google_id']} preview {rec['preview']}") if rec else ""
            print(f"{status} [{sec['key']}] {book['title']} — {extra}")
            for line in log:
                print(f"       {line}")
            if rec:
                records.append(rec)
                n += 1
            else:
                problems.append(f"{book['title']}: dropped ({'; '.join(log)})")
    for p in problems:
        print("WARNING:", p, file=sys.stderr)
    if check:
        return
    counts = {s["key"]: sum(r["section"] == s["key"] for r in records) for s in SECTIONS}
    catalog = {
        "generated": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "source": "Open Library + Google Books metadata; covers via Open Library Covers; blurbs written for collinslab",
        "sections": SECTIONS,
        "books": records,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {OUT}: {len(records)} books {counts}, "
          f"{sum(r['preview'] for r in records)} with preview, {os.path.getsize(OUT)} bytes")


if __name__ == "__main__":
    main(sys.argv[1:])
