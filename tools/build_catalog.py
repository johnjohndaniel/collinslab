#!/usr/bin/env python3
"""Build public/bookstore/catalog.json for the collinslab 3D bookstore.

Downloads public-domain texts from Project Gutenberg (cached in
~/.cache/collinslab/gutenberg/), verifies each file's Title/Author header,
extracts the opening of the actual work (skipping front matter), and writes
the catalogue with hand-written blurbs and taglines.

Usage:
    python3 tools/build_catalog.py            # build the catalogue
    python3 tools/build_catalog.py --show ID  # print one book's extracted opening
    python3 tools/build_catalog.py --dump     # print every opening (for spot checks)

Standard library only.  Polite access: descriptive User-Agent, ~2 s between
network requests, one retry, cached files never re-fetched.

Per-book extraction overrides (keys in a BOOKS entry):
    start   regex matched against the body's lines (trailing space removed, leading
            kept, so "^PREFACE" skips an indented table-of-contents entry); the opening
            begins at that line.  Without it a heuristic picks the first
            chapter-like heading followed by real prose.
    nth     use the nth match of `start` (1-based, default 1); used to skip
            a table of contents that repeats the heading text.
    hlines  number of paragraphs (blank-line separated blocks) that form the
            heading, default: auto (1, plus a following short title line).
    heading literal heading to record instead of the extracted one.
    verse   keep line breaks (poetry and verse drama).
    drop    regex; paragraphs matching it are removed (e.g. stage notes).
    verse_first  keep line breaks in the first N text paragraphs (an epigraph).
    drop_indented  remove indented blocks (editor's notes set inside the text).
    join_cont    in verse, join deeper-indented continuation lines to the line above.
    noindent     the whole text is indented, so indented blocks are not verse.
    trim    regex removed from the start of the first text paragraph (for books
            whose heading shares a line with the text).
"""

import datetime
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "bookstore", "catalog.json")
CACHE = os.path.expanduser("~/.cache/collinslab/gutenberg")
URL = "https://www.gutenberg.org/cache/epub/{id}/pg{id}.txt"
UA = "collinslab-bookstore-catalog/1.0"
DELAY = 2.0

MIN_CHARS = 5000
MAX_CHARS = 6000

SECTIONS = [
    {"key": "fiction", "label": "Classic Fiction"},
    {"key": "adventure", "label": "Adventure & Voyages"},
    {"key": "gothic", "label": "Gothic, Mystery & Horror"},
    {"key": "philosophy", "label": "Philosophy & Ideas"},
    {"key": "science", "label": "Science & Nature"},
    {"key": "poetry", "label": "Poetry & Drama"},
    {"key": "children", "label": "Children's Classics"},
    {"key": "society", "label": "History & Society"},
]

# `check` = substrings that must appear in the file's Title: and Author: header
# lines (case-insensitive), used to verify the Gutenberg ID.
BOOKS = [
    # ---------------------------------------------------------------- fiction
    dict(g=1342, section="fiction", title="Pride and Prejudice", author="Jane Austen",
         start=r"^It is a truth universally", hlines=0, heading="Chapter I",
         check=("Pride and Prejudice", "Austen"), year=1813, pages=432,
         tagline="Five sisters. One fortune. Endless opinions.",
         blurb="When a wealthy young bachelor rents the grand house nearby, the Bennet household "
               "erupts into schemes, gossip and hope. Quick-witted Elizabeth Bennet trusts her first "
               "impressions completely, especially her low opinion of the proud Mr. Darcy. Austen's "
               "sparkling comedy of manners is as sharp about money and marriage as it is about love."),
    dict(g=1260, section="fiction", title="Jane Eyre", author="Charlotte Brontë",
         check=("Jane Eyre", "Bront"), year=1847, pages=532,
         tagline="Poor, plain, and utterly unbowed.",
         blurb="An orphan raised without kindness grows into a governess with a fierce sense of her "
               "own worth. At Thornfield Hall she finds a brooding employer, a house full of strange "
               "noises, and a love that tests everything she believes. A passionate first-person "
               "novel that still feels startlingly modern."),
    dict(g=145, section="fiction", title="Middlemarch", author="George Eliot",
         start=r"^PRELUDE\.", heading="Prelude",
         check=("Middlemarch", "Eliot"), year=1871, pages=880,
         tagline="A whole town, seen from the inside.",
         blurb="Idealistic Dorothea Brooke longs to do something great with her life; ambitious young "
               "doctor Tertius Lydgate means to reform medicine. In a provincial English town on the eve "
               "of reform, their hopes collide with marriage, money and gossip. Eliot's panoramic novel "
               "is generous, wise and endlessly observant about ordinary lives."),
    dict(g=2554, section="fiction", title="Crime and Punishment", author="Fyodor Dostoevsky",
         check=("Crime and Punishment", "Dostoyevsky"), year=1866, pages=576,
         tagline="One idea. One axe. No escape.",
         blurb="In a stifling St. Petersburg summer, a penniless former student convinces himself that "
               "an extraordinary man may step over the moral law. Then he tests the theory. Dostoevsky's "
               "feverish psychological thriller follows Raskolnikov through guilt, delirium and a "
               "cat-and-mouse game with a patient detective."),
    dict(g=64317, section="fiction", title="The Great Gatsby", author="F. Scott Fitzgerald",
         check=("Great Gatsby", "Fitzgerald"), year=1925, pages=180,
         tagline="Green light, gold parties, old longing.",
         blurb="Nick Carraway rents a cottage on Long Island next door to the mysterious Jay Gatsby, "
               "whose lavish parties draw half of New York. Across the bay lives Daisy Buchanan, and the "
               "past Gatsby cannot let go of. A short, shimmering novel about wealth, reinvention and "
               "the American dream."),
    dict(g=98, section="fiction", title="A Tale of Two Cities", author="Charles Dickens",
         check=("Tale of Two Cities", "Dickens"), year=1859, pages=448,
         tagline="London, Paris, and the Terror between.",
         blurb="A doctor freed after eighteen years in the Bastille, his devoted daughter, and two men "
               "who look uncannily alike are drawn into the storm of the French Revolution. Dickens moves "
               "between quiet London and a Paris boiling over, building to one of the most famous "
               "sacrifices in literature."),
    dict(g=1399, section="fiction", title="Anna Karenina", author="Leo Tolstoy",
         check=("Anna Karenina", "Tolstoy"), year=1878, pages=864,
         tagline="Every unhappy family, in its own way.",
         blurb="A brilliant St. Petersburg society woman meets a dashing cavalry officer at a railway "
               "station, and her settled life begins to come apart. Alongside her story runs that of "
               "Levin, a restless landowner searching for meaning in farming, faith and family. "
               "Tolstoy's great novel of passion and conscience."),
    dict(g=5200, section="fiction", title="The Metamorphosis", author="Franz Kafka",
         check=("Metamorphosis", "Kafka"), year=1915, pages=96,
         tagline="He woke up as something else.",
         blurb="Gregor Samsa, a travelling salesman who supports his whole family, wakes one morning "
               "transformed into a monstrous insect, and his first worry is missing his train. Kafka's "
               "darkly funny novella follows a household adjusting, badly, to the impossible."),

    # -------------------------------------------------------------- adventure
    dict(g=2701, section="adventure", title="Moby-Dick", author="Herman Melville",
         start=r"^CHAPTER 1\. Loomings", nth=2, heading="Chapter 1. Loomings.",
         check=("Moby", "Melville"), year=1851, pages=720,
         tagline="A whale. An obsession. The sea.",
         blurb="Ishmael signs aboard the whaler Pequod, only to learn that its captain has one purpose: "
               "to hunt down the white whale that took his leg. Melville's vast, strange, often funny "
               "masterpiece mixes sea adventure with philosophy, natural history and a captain's "
               "magnificent madness."),
    dict(g=120, section="adventure", title="Treasure Island", author="Robert Louis Stevenson",
         start=r"^I$", hlines=2, heading="Part One: The Old Buccaneer. I. The Old Sea-dog at the Admiral Benbow",
         check=("Treasure Island", "Stevenson"), year=1883, pages=240,
         tagline="Pirates, a map, and a one-legged cook.",
         blurb="Young Jim Hawkins finds a treasure map in a dead sailor's sea chest and soon ships out "
               "for a distant island. Among the crew is the charming, untrustworthy Long John Silver. "
               "The book that gave us X marks the spot, and still the best pirate story there is."),
    dict(g=521, section="adventure", title="Robinson Crusoe", author="Daniel Defoe",
         check=("Robinson Crusoe", "Defoe"), year=1719, pages=320,
         tagline="Shipwrecked, alone, and starting from nothing.",
         blurb="A restless young Englishman ignores his father's advice, goes to sea, and ends up the "
               "lone survivor on an uninhabited island. With salvaged tools and stubborn ingenuity he "
               "builds a life from scratch. The original castaway tale, told in meticulous, absorbing "
               "detail."),
    dict(g=164, section="adventure", title="Twenty Thousand Leagues Under the Sea", author="Jules Verne",
         check=("Twenty Thousand Leagues", "Verne"), year=1870, pages=432,
         tagline="A submarine, a mystery, the deep ocean.",
         blurb="Ships are being sunk by an unknown sea monster, and a French naturalist joins the hunt. "
               "What he finds is the Nautilus, a marvellous submarine commanded by the brilliant and "
               "embittered Captain Nemo. A voyage through coral forests, sunken cities and polar ice."),
    dict(g=103, section="adventure", title="Around the World in Eighty Days", author="Jules Verne",
         check=("Eighty Days", "Verne"), year=1872, pages=256,
         tagline="A wager, a valet, and a clock.",
         blurb="The precise and unflappable Phileas Fogg bets his fortune that he can circle the globe in "
               "eighty days. With his excitable valet Passepartout and a detective on his trail, he races "
               "by steamer, train and elephant. A brisk, good-humoured adventure."),
    dict(g=829, section="adventure", title="Gulliver's Travels", author="Jonathan Swift",
         start=r"^CHAPTER I\.$", drop=r"^The author gives some account", heading="Part I. A Voyage to Lilliput. Chapter I.",
         check=("Gulliver", "Swift"), year=1726, pages=336,
         tagline="Tiny people, giants, and talking horses.",
         blurb="Ship's surgeon Lemuel Gulliver keeps getting shipwrecked in very odd places: among people "
               "six inches tall, among giants, on a flying island of scientists. Swift's travel tale is "
               "a playful adventure on the surface and a ferocious satire of humankind underneath."),
    dict(g=1184, section="adventure", title="The Count of Monte Cristo", author="Alexandre Dumas",
         drop=r"^\d{4}m$",
         check=("Monte Cristo", "Dumas"), year=1844, pages=1276,
         tagline="Betrayed, imprisoned, and patiently returning.",
         blurb="On the day of his wedding, young sailor Edmond Dantès is falsely accused and thrown into "
               "an island fortress. Years later a mysterious, fabulously rich count arrives in Paris. "
               "Dumas's grand tale of injustice, escape and elaborate revenge is a page-turner of epic "
               "length."),
    dict(g=215, section="adventure", title="The Call of the Wild", author="Jack London",
         verse_first=1,
         check=("Call of the Wild", "London"), year=1903, pages=128,
         tagline="From California porch to Yukon trail.",
         blurb="Buck, a big, comfortable dog on a California estate, is stolen and sold into the brutal "
               "world of the Klondike gold rush. Pulling sleds through snow, he learns the law of club "
               "and fang. A short, vivid adventure told from the dog's point of view."),

    # ----------------------------------------------------------------- gothic
    dict(g=84, section="gothic", title="Frankenstein", author="Mary Shelley",
         check=("Frankenstein", "Shelley"), year=1818, pages=280,
         tagline="He built a life. It came looking.",
         blurb="A young scientist discovers the secret of animating dead matter and builds a living being, "
               "then recoils in horror from what he has made. Told through letters from an Arctic "
               "expedition, Shelley's novel is the first great science-fiction story and a haunting "
               "study of responsibility and loneliness."),
    dict(g=345, section="gothic", title="Dracula", author="Bram Stoker",
         check=("Dracula", "Stoker"), year=1897, pages=418,
         tagline="Never accept a Transylvanian invitation.",
         blurb="Solicitor Jonathan Harker travels to a remote castle in the Carpathians to help a "
               "nobleman buy property in England. His host is courteous, ancient, and never seen to eat. "
               "Told in diaries, letters and newspaper clippings, the vampire novel that defined the genre."),
    dict(g=43, section="gothic", title="Strange Case of Dr Jekyll and Mr Hyde", author="Robert Louis Stevenson",
         start=r"^STORY OF THE DOOR", heading="Story of the Door",
         check=("Jekyll", "Stevenson"), year=1886, pages=96,
         tagline="Two men. One respectable door.",
         blurb="A London lawyer grows uneasy about his friend Dr. Jekyll's connection to the repellent "
               "Edward Hyde, a man who tramples a child and walks away. Stevenson's compact, fog-bound "
               "mystery about the divided self is still unsettling."),
    dict(g=174, section="gothic", title="The Picture of Dorian Gray", author="Oscar Wilde",
         check=("Dorian Gray", "Wilde"), year=1890, pages=256,
         tagline="He stays young. The portrait doesn't.",
         blurb="A beautiful young man wishes that his portrait would age instead of him, and the wish "
               "comes true. Encouraged by a witty, corrupting friend, Dorian pursues every pleasure while "
               "the painting in the locked room keeps the record. Wilde's only novel glitters with "
               "epigrams and dread."),
    dict(g=1661, section="gothic", title="The Adventures of Sherlock Holmes", author="Arthur Conan Doyle",
         start=r"^I\. A SCANDAL IN BOHEMIA", hlines=2, heading="I. A Scandal in Bohemia",
         check=("Adventures of Sherlock Holmes", "Doyle"), year=1892, pages=307,
         tagline="Twelve cases from 221B Baker Street.",
         blurb="A king with a compromising photograph, a red-headed man paid to copy the encyclopaedia, "
               "a speckled band in the dark. Twelve of the most celebrated Holmes stories, narrated by "
               "the loyal Dr. Watson. The perfect introduction to the world's great consulting detective."),
    dict(g=2852, section="gothic", title="The Hound of the Baskervilles", author="Arthur Conan Doyle",
         noindent=True,
         check=("Hound of the Baskervilles", "Doyle"), year=1902, pages=256,
         tagline="Footprints of a gigantic hound.",
         blurb="Sir Charles Baskerville is found dead on the edge of Dartmoor, his face twisted in terror, "
               "and a family legend speaks of a spectral hound. Holmes sends Watson to the lonely moor "
               "to guard the heir. The most atmospheric of all the Sherlock Holmes novels."),
    dict(g=209, section="gothic", title="The Turn of the Screw", author="Henry James",
         start=r"^THE TURN OF THE SCREW$", heading="The Turn of the Screw",
         check=("Turn of the Screw", "James"), year=1898, pages=128,
         tagline="Two children, a governess, and visitors.",
         blurb="A young governess takes charge of two charming orphans at a remote country house, and "
               "begins to see figures who should not be there. Are the children in danger, or is she? "
               "Henry James's ghost story is famous for refusing to give an easy answer."),
    dict(g=10007, section="gothic", title="Carmilla", author="Sheridan Le Fanu",
         check=("Carmilla", "Le Fanu"), year=1872, pages=128,
         tagline="A lonely castle, a beautiful guest.",
         blurb="In a remote Styrian castle, young Laura welcomes a mysterious guest after a carriage "
               "accident: the languid, beautiful Carmilla. As their friendship deepens, the girls of the "
               "district begin to sicken. This eerie novella predates Dracula by a quarter century."),

    # ------------------------------------------------------------- philosophy
    dict(g=2680, section="philosophy", title="Meditations", author="Marcus Aurelius",
         start=r"^THE FIRST BOOK$", heading="The First Book",
         check=("Meditations", "Marcus Aurelius"), year=180, pages=256,
         tagline="An emperor's private notes on living well.",
         blurb="The most powerful man in the Roman world wrote these notes to himself, never meaning "
               "them to be read. They are reminders to be patient, to do his duty, and to remember how "
               "brief everything is. Stoic philosophy at its most personal and practical."),
    dict(g=1497, section="philosophy", title="The Republic", author="Plato",
         check=("Republic", "Plato"), year=-375, pages=416,
         tagline="What is justice? Socrates won't let go.",
         blurb="A friendly conversation in a house near Athens turns into one of the boldest thought "
               "experiments ever written: the design of a perfectly just city. Along the way Socrates "
               "introduces philosopher-kings, the Ring of Gyges and the allegory of the cave."),
    dict(g=1232, section="philosophy", title="The Prince", author="Niccolò Machiavelli",
         start=r"^CHAPTER I\.$", hlines=2, heading="Chapter I. How Many Kinds of Principalities There Are, and by What Means They Are Acquired",
         check=("Prince", "Machiavelli"), year=1532, pages=140,
         tagline="How power is actually won and kept.",
         blurb="A Florentine diplomat out of a job writes a short handbook for rulers, and drops the "
               "pieties. Is it better to be loved or feared? Machiavelli answers with case studies from "
               "Renaissance Italy and ancient Rome, in prose that is crisp, practical and notorious."),
    dict(g=4363, section="philosophy", title="Beyond Good and Evil", author="Friedrich Nietzsche",
         start=r"^PREFACE$", heading="Preface",
         check=("Beyond Good and Evil", "Nietzsche"), year=1886, pages=240,
         tagline="Philosophy with a hammer and a grin.",
         blurb="Nietzsche takes aim at the hidden prejudices of philosophers, the morality of the herd, "
               "and the very idea of absolute truth. Written in short, provocative sections, this is the "
               "most readable entry point to his thought: aphoristic, combative and unexpectedly funny."),
    dict(g=34901, section="philosophy", title="On Liberty", author="John Stuart Mill",
         start=r"^CHAPTER I\.$", nth=2, hlines=2, heading="Chapter I. Introductory",
         check=("On Liberty", "Mill"), year=1859, pages=128,
         tagline="Where society's power over you ends.",
         blurb="When may a society interfere with what an individual says or does? Mill's answer, the "
               "harm principle, became a cornerstone of liberal thought. A clear, passionate defence of "
               "free speech, individuality and the value of being allowed to be wrong."),
    dict(g=46333, section="philosophy", title="The Social Contract", author="Jean-Jacques Rousseau",
         start=r"^BOOK I$", nth=2, heading="Book I",
         check=("social contract", "Rousseau"), year=1762, pages=192,
         tagline="Born free, and everywhere in chains.",
         blurb="What could make the power of a government legitimate? Rousseau's answer, an agreement in "
               "which each person places himself under the general will, inspired revolutionaries and "
               "still unsettles political theory. Compact, quotable and radical, it opens with one of the "
               "most famous sentences in philosophy."),
    dict(g=59, section="philosophy", title="Discourse on the Method", author="René Descartes",
         check=("Discourse", "Descartes"), year=1637, pages=96,
         tagline="Doubt everything. Then begin.",
         blurb="Descartes tells the story of his own education and how he decided to throw out every "
               "belief he could doubt and rebuild knowledge from the ground up. A short, personal, "
               "surprisingly readable book that launched modern philosophy and gave us \"I think, "
               "therefore I am.\""),
    dict(g=2130, section="philosophy", title="Utopia", author="Thomas More",
         start=r"^DISCOURSES OF RAPHAEL HYTHLODAY", heading="Discourses of Raphael Hythloday, of the Best State of a Commonwealth",
         check=("Utopia", "More"), year=1516, pages=160,
         tagline="The island that is nowhere.",
         blurb="A traveller back from the New World describes an island where there is no private "
               "property, gold is used for chamber pots, and everyone works six hours a day. Thomas More's "
               "witty dialogue invented a word and a whole genre of imagined societies."),

    # ---------------------------------------------------------------- science
    dict(g=1228, section="science", title="On the Origin of Species", author="Charles Darwin",
         start=r"^INTRODUCTION\.$", nth=2, heading="Introduction",
         check=("Origin of Species", "Darwin"), year=1859, pages=512,
         tagline="Endless forms most beautiful.",
         blurb="From pigeon breeding to barnacles, from island finches to the struggle for existence, "
               "Darwin assembles a mountain of evidence for one revolutionary idea: species change through "
               "natural selection. The first edition of the book that transformed biology."),
    dict(g=944, section="science", title="The Voyage of the Beagle", author="Charles Darwin",
         drop=r"^Porto Praya",
         check=("Beagle", "Darwin"), year=1839, pages=528,
         tagline="Five years at sea with a young naturalist.",
         blurb="Aged twenty-two, Charles Darwin sailed around the world as a naturalist aboard HMS Beagle. "
               "His journal is full of earthquakes, gauchos, giant fossils, coral reefs and the "
               "Galapagos. A lively travel book that captures a great mind just waking up."),
    dict(g=205, section="science", title="Walden", author="Henry David Thoreau",
         start=r"^Economy$", heading="Economy",
         check=("Walden", "Thoreau"), year=1854, pages=352,
         tagline="Two years in a cabin by a pond.",
         blurb="In 1845 Thoreau built a small cabin beside Walden Pond and lived there simply, to see "
               "what life really required. His account of beans, ice, ants, loons and the changing "
               "seasons is also a sharp challenge to how the rest of us spend our days."),
    dict(g=201, section="science", title="Flatland", author="Edwin A. Abbott",
         start=r"^Section 1\.", drop=r"^\[ASCII|^\(1\) \(2\)", heading="Part I: This World. Section 1. Of the Nature of Flatland",
         check=("Flatland", "Abbott"), year=1884, pages=112,
         tagline="A romance of many dimensions.",
         blurb="A Square living in a two-dimensional world describes its society of lines, triangles and "
               "polygons, until a visitor from the third dimension turns his world inside out. A "
               "playful mathematical fantasy and a sly satire of Victorian society."),
    dict(g=30155, section="science", title="Relativity: The Special and General Theory", author="Albert Einstein",
         check=("Relativity", "Einstein"), year=1916, pages=168,
         tagline="Einstein explains Einstein, with trains.",
         blurb="Einstein wrote this short book for readers without advanced mathematics, using trains, "
               "embankments and lightning flashes to explain why space and time are not what they seem. "
               "The theory of relativity, in its author's own clear voice."),
    dict(g=14474, section="science", title="The Chemical History of a Candle", author="Michael Faraday",
         start=r"^LECTURE I\.$", nth=2, hlines=2, heading="Lecture I. A Candle: The Flame, Its Sources, Structure, Mobility, Brightness",
         check=("Candle", "Faraday"), year=1861, pages=160,
         tagline="The whole of science in one flame.",
         blurb="In a series of Christmas lectures for young people, Michael Faraday lit a candle and used "
               "it to explain combustion, air, water and the chemistry of breathing. Full of "
               "demonstrations and infectious enthusiasm, a model of how to teach science."),
    dict(g=1408, section="science", title="The Natural History of Selborne", author="Gilbert White",
         drop=r"^\* ",
         check=("Selborne", "White"), year=1789, pages=288,
         tagline="A parson, a parish, and its swallows.",
         blurb="For decades the curate of a small Hampshire village watched its birds, tortoises, crickets "
               "and weather with patient curiosity, and wrote it all down in letters to fellow "
               "naturalists. A gentle classic of close observation and one of the most reprinted books in "
               "English."),
    dict(g=32540, section="science", title="My First Summer in the Sierra", author="John Muir",
         check=("First Summer in the Sierra", "Muir"), year=1911, pages=272,
         tagline="Mountains, meadows, and pure delight.",
         blurb="In 1869 a young John Muir took a job herding sheep into the high Sierra Nevada, and fell "
               "in love with every tree, stone and waterfall. His journal of that summer bursts with joy "
               "and close observation, the beginnings of America's conservation movement."),

    # ----------------------------------------------------------------- poetry
    dict(g=1524, section="poetry", title="Hamlet", author="William Shakespeare",
         start=r"^ACT I$", hlines=2, verse=True, heading="ACT I. SCENE I. Elsinore. A platform before the Castle.",
         check=("Hamlet", "Shakespeare"), year=1603, pages=342,
         tagline="Something is rotten in Denmark.",
         blurb="A ghost on the battlements of Elsinore tells Prince Hamlet that his father was murdered, "
               "and the murderer now wears the crown. Torn between duty and doubt, Hamlet feigns madness "
               "and sets out to catch the conscience of the king. The most quoted play in English."),
    dict(g=1513, section="poetry", title="Romeo and Juliet", author="William Shakespeare",
         start=r"^THE PROLOGUE$", verse=True, heading="The Prologue", drop=r"^\[Exit",
         check=("Romeo and Juliet", "Shakespeare"), year=1597, pages=320,
         tagline="Two households, alike in dignity.",
         blurb="In the hot streets of Verona, the son and daughter of two feuding families meet at a "
               "masked ball and fall instantly in love. Shakespeare's early tragedy is full of sword "
               "fights, jokes, balcony scenes and some of the most beautiful poetry he ever wrote."),
    dict(g=1041, section="poetry", title="Shakespeare's Sonnets", author="William Shakespeare",
         verse=True,
         check=("Sonnets", "Shakespeare"), year=1609, pages=176,
         tagline="Fourteen lines against time.",
         blurb="One hundred and fifty-four sonnets addressed to a beautiful young man and a mysterious dark "
               "lady, exploring beauty, desire, jealousy and the power of verse to outlast death. Small "
               "poems with enormous range."),
    dict(g=1322, section="poetry", title="Leaves of Grass", author="Walt Whitman",
         start=r"^One’s-Self I Sing$", verse=True, join_cont=True, heading="Book I. Inscriptions. One’s-Self I Sing",
         check=("Leaves of Grass", "Whitman"), year=1855, pages=464,
         tagline="I celebrate myself, and sing myself.",
         blurb="Whitman spent his life expanding this book, a sprawling, democratic, free-verse embrace of "
               "America, the body and the open road. Long lines catalogue workers, soldiers, cities and "
               "stars. Poetry that sounds like no one before it."),
    dict(g=26, section="poetry", title="Paradise Lost", author="John Milton",
         verse=True,
         check=("Paradise Lost", "Milton"), year=1667, pages=453,
         tagline="Rebel angels and the fall of man.",
         blurb="Satan and his followers wake in hell after their failed rebellion and plot their revenge on "
               "God's newest creation. Milton's blank-verse epic ranges from burning lakes to the Garden "
               "of Eden, and his Satan is one of literature's most magnetic figures."),
    dict(g=1001, section="poetry", title="Inferno", author="Dante Alighieri",
         start=r"^Inferno: Canto I$", verse=True, heading="Canto I",
         check=("Hell", "Dante"), year=1320, pages=432,
         tagline="Midway through life, lost in a dark wood.",
         blurb="Guided by the poet Virgil, Dante descends through the nine circles of Hell, meeting the "
               "souls of lovers, gluttons, traitors and popes on the way down. The first part of the "
               "Divine Comedy, here in Henry Wadsworth Longfellow's translation."),
    dict(g=12242, section="poetry", title="Poems by Emily Dickinson", author="Emily Dickinson",
         start=r"^SUCCESS\.$", verse=True, drop=r"^\[", heading="I. Success",
         check=("Poems", "Dickinson"), year=1890, pages=160,
         tagline="Tell all the truth but tell it slant.",
         blurb="Short, startling poems about bees, death, sunsets, faith and the inner life, written by a "
               "poet who rarely left her family home in Amherst. This first collection appeared four years "
               "after her death and announced a wholly original voice."),
    dict(g=844, section="poetry", title="The Importance of Being Earnest", author="Oscar Wilde",
         start=r"^FIRST ACT$", drop=r"^SCENE$", heading="First Act",
         check=("Importance of Being Earnest", "Wilde"), year=1895, pages=96,
         tagline="A trivial comedy for serious people.",
         blurb="Two young gentlemen invent fictional people to escape their obligations, and both end up "
               "pretending to be named Ernest. Add a formidable aunt, a handbag and a great deal of "
               "cucumber sandwiches. Wilde's comedy is the wittiest play in the language."),

    # --------------------------------------------------------------- children
    dict(g=11, section="children", title="Alice's Adventures in Wonderland", author="Lewis Carroll",
         check=("Alice", "Carroll"), year=1865, pages=192,
         tagline="Down the rabbit-hole, curiouser and curiouser.",
         blurb="Bored on a riverbank, Alice follows a White Rabbit with a pocket watch down a rabbit-hole "
               "and into a world of shrinking potions, mad tea parties and a croquet-playing queen. "
               "Carroll's nonsense classic delights children and keeps grown-ups puzzling."),
    dict(g=55, section="children", title="The Wonderful Wizard of Oz", author="L. Frank Baum",
         check=("Wizard of Oz", "Baum"), year=1900, pages=208,
         tagline="A cyclone, a yellow brick road.",
         blurb="A Kansas cyclone carries Dorothy and her dog Toto to the colourful Land of Oz. To get home "
               "she must reach the Emerald City, picking up a Scarecrow, a Tin Woodman and a Cowardly Lion "
               "along the way. America's own fairy tale."),
    dict(g=16, section="children", title="Peter Pan", author="J. M. Barrie",
         check=("Peter Pan", "Barrie"), year=1911, pages=192,
         tagline="Second star to the right.",
         blurb="One night a boy who refuses to grow up flies into the Darling children's nursery looking "
               "for his shadow, and takes Wendy, John and Michael away to Neverland. Pirates, mermaids, "
               "lost boys and a crocodile that ticks."),
    dict(g=289, section="children", title="The Wind in the Willows", author="Kenneth Grahame",
         check=("Wind in the Willows", "Grahame"), year=1908, pages=224,
         tagline="Messing about in boats.",
         blurb="Mole abandons his spring cleaning and discovers the river, where he befriends the "
               "boat-loving Water Rat, the gruff Badger and the wildly reckless Mr. Toad. A gentle, funny "
               "riverbank idyll and a celebration of friendship and home."),
    dict(g=113, section="children", title="The Secret Garden", author="Frances Hodgson Burnett",
         check=("Secret Garden", "Burnett"), year=1911, pages=288,
         tagline="A locked door, a buried key.",
         blurb="Sour, lonely Mary Lennox is sent from India to live in her uncle's gloomy Yorkshire manor, "
               "with a hundred locked rooms and crying in the night. Then a robin shows her the way into "
               "a garden no one has entered for ten years. A story about things coming back to life."),
    dict(g=45, section="children", title="Anne of Green Gables", author="L. M. Montgomery",
         check=("Anne of Green Gables", "Montgomery"), year=1908, pages=320,
         tagline="Talkative, red-haired, and full of imagination.",
         blurb="Elderly siblings Matthew and Marilla Cuthbert ask for an orphan boy to help on their "
               "Prince Edward Island farm. Instead they get Anne Shirley: red-haired, dreamy, and "
               "unstoppably talkative. A warm, funny story that has won readers for over a century."),
    dict(g=236, section="children", title="The Jungle Book", author="Rudyard Kipling",
         start=r"^Mowgli’s Brothers$", heading="Mowgli’s Brothers",
         check=("Jungle Book", "Kipling"), year=1894, pages=208,
         tagline="Raised by wolves, taught by a bear.",
         blurb="A human baby wanders into a wolf den and is raised by the pack, taught the Law of the "
               "Jungle by Baloo the bear and Bagheera the panther, and hunted by the tiger Shere Khan. "
               "Mowgli's stories sit alongside other tales, including the brave mongoose Rikki-Tikki-Tavi."),
    dict(g=514, section="children", title="Little Women", author="Louisa May Alcott",
         start=r"^CHAPTER ONE$", hlines=2, heading="Chapter One. Playing Pilgrims",
         check=("Little Women", "Alcott"), year=1868, pages=480,
         tagline="Four sisters, growing up together.",
         blurb="With their father away at war and money tight, the four March sisters, responsible Meg, "
               "fiery Jo, gentle Beth and artistic Amy, put on plays, make mistakes and find their own "
               "paths. Alcott's beloved story of family, ambition and growing up."),

    # ---------------------------------------------------------------- society
    dict(g=408, section="society", title="The Souls of Black Folk", author="W. E. B. Du Bois",
         start=r"^The Forethought$", heading="The Forethought",
         check=("Souls of Black Folk", "Du Bois"), year=1903, pages=272,
         tagline="The problem of the color-line.",
         blurb="Mixing history, sociology, memoir and music, Du Bois examines Black life in America a "
               "generation after emancipation. He introduces the idea of double consciousness and opens "
               "each chapter with a spiritual. A founding work of American thought."),
    dict(g=132, section="society", title="The Art of War", author="Sun Tzu",
         start=r"^Chapter I\. LAYING PLANS", drop=r"^\[", heading="Chapter I. Laying Plans",
         check=("Art of War", "Sun"), year=-500, pages=112,
         tagline="Win without fighting.",
         blurb="Thirteen short chapters on strategy from ancient China: on planning, deception, terrain, "
               "spies and knowing yourself and your enemy. Read for two and a half millennia by generals, "
               "and now by athletes, executives and anyone facing a contest."),
    dict(g=23, section="society", title="Narrative of the Life of Frederick Douglass", author="Frederick Douglass",
         start=r"CHAPTER I$", nth=2, heading="Chapter I",
         check=("Frederick Douglass", "Douglass"), year=1845, pages=128,
         tagline="Born enslaved. Taught himself freedom.",
         blurb="Douglass recounts his childhood in slavery on Maryland plantations, his secret struggle to "
               "learn to read, and the turning point when he fought back. A powerful, precise memoir that "
               "became one of the most influential books of the abolitionist movement."),
    dict(g=3420, section="society", title="A Vindication of the Rights of Woman", author="Mary Wollstonecraft",
         check=("Vindication of the Rights of Woman", "Wollstonecraft"), year=1792, pages=320,
         tagline="Reason has no sex.",
         blurb="Wollstonecraft argues that women appear frivolous only because they are denied an "
               "education, and that a nation of rational, educated women would benefit everyone. A bold, "
               "impassioned founding text of feminist philosophy."),
    dict(g=147, section="society", title="Common Sense", author="Thomas Paine",
         start=r"^INTRODUCTION\.$", drop=r"^AUTHOR$", heading="Introduction",
         check=("Common Sense", "Paine"), year=1776, pages=64,
         tagline="The pamphlet that argued for independence.",
         blurb="In January 1776 a recent English immigrant published a short pamphlet arguing, in plain "
               "and fiery language, that the American colonies should break with the Crown. It sold in "
               "enormous numbers and helped turn a rebellion into a revolution."),
    dict(g=61, section="society", title="The Communist Manifesto", author="Karl Marx and Friedrich Engels",
         check=("Communist Manifesto", "Marx"), year=1848, pages=64,
         tagline="A spectre is haunting Europe.",
         blurb="Written for a small workers' league on the eve of the 1848 revolutions, this pamphlet "
               "lays out a history of class struggle and a fierce critique of industrial capitalism. "
               "Few short texts have had such an enormous effect on the world."),
    dict(g=20203, section="society", title="The Autobiography of Benjamin Franklin", author="Benjamin Franklin",
         drop_indented=True, heading="I. Ancestry and Early Youth in Boston",
         check=("Autobiography", "Franklin"), year=1791, pages=192,
         tagline="Printer, inventor, statesman, self-made man.",
         blurb="Franklin tells how a runaway printer's apprentice became one of the most famous men in the "
               "world, with practical advice, a plan for moral perfection and plenty of self-deprecating "
               "humour along the way. The original American success story."),
    dict(g=45502, section="society", title="How the Other Half Lives", author="Jacob A. Riis",
         check=("Other Half Lives", "Riis"), year=1890, pages=304,
         tagline="Inside New York's tenements.",
         blurb="A police reporter takes readers into the crowded tenements of Lower Manhattan: the "
               "sweatshops, cellars and lodging houses where immigrant families struggled to survive. "
               "Riis's pioneering exposé shocked middle-class America into reform."),
]


# --------------------------------------------------------------------------
# Download
# --------------------------------------------------------------------------

_last_fetch = [0.0]


def fetch(gid):
    """Return the text of Gutenberg book `gid`, from cache or network (one retry)."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"pg{gid}.txt")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, "rb") as f:
            return f.read().decode("utf-8", errors="replace")
    for attempt in range(2):
        wait = DELAY - (time.time() - _last_fetch[0])
        if wait > 0:
            time.sleep(wait)
        _last_fetch[0] = time.time()
        try:
            req = urllib.request.Request(URL.format(id=gid), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return data.decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001 - report and retry once
            print(f"  fetch pg{gid} failed (attempt {attempt + 1}): {e}", file=sys.stderr)
    return None


def header_field(raw, name):
    m = re.search(rf"^{name}:\s*(.+(?:\n[ \t]+.+)*)", raw, re.M)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def verify(book, raw):
    title, author = header_field(raw, "Title"), header_field(raw, "Author")
    want_t, want_a = book["check"]
    ok = want_t.lower() in title.lower() and want_a.lower() in author.lower()
    return ok, title, author


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

START_RE = re.compile(r"^\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK.*$", re.M | re.I)
END_RE = re.compile(r"^\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK.*$", re.M | re.I)

HEADING_RE = re.compile(
    r"^(CHAPTER|Chapter|BOOK|Book|LETTER|Letter|ACT|Act|PART|Part|STAVE|CANTO|Canto|SECTION)\b"
    r"|^[IVXLC]+\.?$|^\d+\.?$"
)


def body_of(raw):
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    s = START_RE.search(raw)
    e = END_RE.search(raw)
    body = raw[s.end() if s else 0: e.start() if e else len(raw)]
    return body.replace("﻿", "")


def clean_inline(text):
    text = re.sub(r"\[Illustration(?:[^\[\]]|\[[^\]]*\])*\]", "", text, flags=re.S)
    text = re.sub(r"\[(Footnote|Note)[^\]]*\]", "", text, flags=re.S)
    text = re.sub(r"\[\d+\]|\[[a-z]\]", "", text)
    text = re.sub(r"(?<![A-Za-z0-9])_([^_]+?)_(?![A-Za-z0-9])", r"\1", text, flags=re.S)
    text = text.replace("_", "")
    text = re.sub(r"\{\d+\}", "", text)
    return text


def paragraphs(lines):
    """Split a list of lines into blank-line separated blocks (lists of lines)."""
    out, cur = [], []
    for ln in lines:
        if ln.strip():
            cur.append(ln.rstrip())
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def is_prose_para(block):
    return len(" ".join(x.strip() for x in block)) >= 250


def find_start(lines, book):
    """Index of the first line of the opening heading."""
    if "start" in book:
        rx = re.compile(book["start"])
        nth = book.get("nth", 1)
        for i, ln in enumerate(lines):
            if rx.search(ln.rstrip()):
                nth -= 1
                if nth == 0:
                    return i
        raise ValueError(f"pg{book['g']}: start marker {book['start']!r} not found")
    for i, ln in enumerate(lines):
        if not HEADING_RE.search(ln.strip()):
            continue
        if i > 0 and lines[i - 1].strip():
            continue  # heading must begin a block
        if len(paragraphs(lines[i: i + 6])[0]) > 3:
            continue  # a long run of short lines is a table of contents
        # look ahead: within the next few blocks there must be real prose,
        # and no other heading first (that would be a table of contents)
        blocks = paragraphs(lines[i + 1: i + 80])[:4]
        for b in blocks:
            if HEADING_RE.search(b[0].strip()):
                break
            if is_prose_para(b):
                return i
    raise ValueError(f"pg{book['g']}: no opening heading found; add a start override")


def format_block(block, verse, indent_verse=True, join_cont=False):
    # indented multi-line blocks inside prose are quoted verse (epigraphs)
    indented = indent_verse and len(block) >= 2 and all(re.match(r"\s{2,}\S", x) for x in block)
    if verse or indented:
        if join_cont:  # deeper-indented lines continue the previous long line
            base = min(len(x) - len(x.lstrip()) for x in block)
            merged = []
            for x in block:
                if merged and len(x) - len(x.lstrip()) >= base + 3:
                    merged[-1] += " " + x.strip()
                else:
                    merged.append(x)
            block = merged
        lines = [re.sub(r"\s+", " ", x.strip()) for x in block]
        return "\n".join(l for l in lines if l)
    return re.sub(r"\s+", " ", " ".join(x.strip() for x in block)).strip()


def is_heading_line(block):
    t = " ".join(x.strip() for x in block)
    return len(block) <= 2 and len(t) <= 70 and not re.search(r"[a-z][.!?]\"?$|,$|;$", t) or t.isupper() and len(t) <= 90


def extract(raw, book):
    verse = book.get("verse", False)
    body = clean_inline(body_of(raw))
    lines = body.split("\n")
    i = find_start(lines, book)
    blocks = paragraphs(lines[i:])
    blocks = [b for b in blocks if " ".join(b).strip()]
    if book.get("drop_indented"):
        blocks = [b for b in blocks if not all(re.match(r"\s{2,}\S", x) for x in b)]
    if "drop" in book:
        rx = re.compile(book["drop"])
        blocks = [b for b in blocks if not rx.search(" ".join(x.strip() for x in b))]
    if "hlines" in book:
        nh = book["hlines"]
    else:
        nh = 1
        if len(blocks) > 1 and is_heading_line(blocks[1]) and not verse and not is_prose_para(blocks[1]):
            nh = 2
    heading = " ".join(re.sub(r"\s+", " ", " ".join(x.strip() for x in b)) for b in blocks[:nh])
    heading = book.get("heading", heading)
    out, total = [], 0
    for k, b in enumerate(blocks[nh:]):
        p = format_block(b, verse or k < book.get("verse_first", 0), not book.get("noindent"), book.get("join_cont", False))
        if k == 0 and "trim" in book:
            p = re.sub(book["trim"], "", p, count=1).lstrip()
        if not p or re.fullmatch(r"[*\s.]+", p):
            continue
        if total >= MIN_CHARS:
            break
        out.append(p)
        total += len(p) + 2
    text = "\n\n".join(out)
    if len(text) > MAX_CHARS + 300:
        # drop the last block if that still leaves enough; else cut at a sentence
        shorter = "\n\n".join(out[:-1])
        if len(shorter) >= MIN_CHARS - 400:
            text = shorter
        elif len(text) <= MAX_CHARS + 800:
            pass  # one long final paragraph; keep it whole
        else:
            cut = text[:MAX_CHARS]
            j = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "), cut.rfind(".\" "), cut.rfind(".” "))
            text = cut[: j + 1] if j > MIN_CHARS - 1000 else cut
    return heading.strip(), text.strip()


# --------------------------------------------------------------------------

def build(books, show=None, dump=False):
    records, problems = [], []
    for book in books:
        if show is not None and book["g"] != show:
            continue
        raw = fetch(book["g"])
        if raw is None:
            problems.append(f"pg{book['g']} {book['title']}: download failed, skipped")
            continue
        ok, t, a = verify(book, raw)
        if not ok:
            problems.append(f"pg{book['g']} {book['title']}: header mismatch (Title: {t!r}, Author: {a!r}), skipped")
            continue
        try:
            heading, text = extract(raw, book)
        except ValueError as e:
            problems.append(str(e))
            print("ERROR:", e)
            continue
        rec = {
            "id": f"pg{book['g']}", "gutenberg": book["g"], "title": book["title"],
            "author": book["author"], "year": book["year"], "section": book["section"],
            "pages": book["pages"], "tagline": book["tagline"], "blurb": book["blurb"],
            "heading": heading, "verse": bool(book.get("verse", False)), "text": text,
        }
        records.append(rec)
        if show is not None or dump:
            print(f"===== pg{book['g']} {book['title']} [{len(text)} chars]\nHEADING: {heading}\n")
            print(text if show is not None else text[:600])
            print()
    return records, problems


def main(argv):
    if "--show" in argv:
        build(BOOKS, show=int(argv[argv.index("--show") + 1]))
        return
    records, problems = build(BOOKS, dump="--dump" in argv)
    for p in problems:
        print("WARNING:", p, file=sys.stderr)
    counts = {s["key"]: sum(r["section"] == s["key"] for r in records) for s in SECTIONS}
    catalog = {
        "generated": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "source": "Project Gutenberg (public-domain texts); blurbs written for collinslab",
        "sections": SECTIONS,
        "books": records,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {OUT}: {len(records)} books {counts}, {os.path.getsize(OUT)} bytes")


if __name__ == "__main__":
    main(sys.argv[1:])
