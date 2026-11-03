-- MySQL dump 10.13  Distrib 5.7.19, for osx10.11 (x86_64)
--
-- Host: localhost    Database: sharkulator
-- ------------------------------------------------------
-- Server version	5.7.19

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `sharkulator`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `sharkulator` /*!40100 DEFAULT CHARACTER SET utf8 */;

USE `sharkulator`;

--
-- Table structure for table `game`
--

DROP TABLE IF EXISTS `game`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `game` (
  `game_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `date` datetime DEFAULT NULL,
  `tournament_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`game_id`),
  KEY `FK2xfdbv4n193efuyajlqh0vs6j` (`tournament_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game`
--

LOCK TABLES `game` WRITE;
/*!40000 ALTER TABLE `game` DISABLE KEYS */;
/*!40000 ALTER TABLE `game` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `outcome`
--

DROP TABLE IF EXISTS `outcome`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `outcome` (
  `outcome_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `result` int(11) NOT NULL,
  `score_value` double NOT NULL,
  `game_id` bigint(20) DEFAULT NULL,
  `user_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`outcome_id`),
  KEY `FKlvom3r4k5ahhb08idp9yb07ak` (`game_id`),
  KEY `FK4essrj1bn8n67umur73r4pcnl` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `outcome`
--

LOCK TABLES `outcome` WRITE;
/*!40000 ALTER TABLE `outcome` DISABLE KEYS */;
/*!40000 ALTER TABLE `outcome` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `role`
--

DROP TABLE IF EXISTS `role`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `role` (
  `role_id` int(11) NOT NULL AUTO_INCREMENT,
  `role` varchar(50) NOT NULL,
  PRIMARY KEY (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `role`
--

LOCK TABLES `role` WRITE;
/*!40000 ALTER TABLE `role` DISABLE KEYS */;
/*!40000 ALTER TABLE `role` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sport`
--

DROP TABLE IF EXISTS `sport`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sport` (
  `sport_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`sport_id`),
  UNIQUE KEY `UK_63em0e8bcxm3pqjooy08wquan` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sport`
--

LOCK TABLES `sport` WRITE;
/*!40000 ALTER TABLE `sport` DISABLE KEYS */;
/*!40000 ALTER TABLE `sport` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `stats`
--

DROP TABLE IF EXISTS `stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stats` (
  `stats_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `best_score` double NOT NULL,
  `game_count` int(11) NOT NULL,
  `longuest_lose_streak` int(11) NOT NULL,
  `longuest_tie_streak` int(11) NOT NULL,
  `longuest_win_streak` int(11) NOT NULL,
  `lose_count` int(11) NOT NULL,
  `lose_streak` int(11) NOT NULL,
  `score` double NOT NULL,
  `tie_count` int(11) NOT NULL,
  `tie_streak` int(11) NOT NULL,
  `win_count` int(11) NOT NULL,
  `win_streak` int(11) NOT NULL,
  `worst_score` double NOT NULL,
  `tournament_id` bigint(20) DEFAULT NULL,
  `user_id` bigint(20) NOT NULL,
  PRIMARY KEY (`stats_id`),
  KEY `FKe2l7af89tmdcrtci6wpcxa833` (`tournament_id`),
  KEY `FK1iu67ious6vd1bpvdl2atmifc` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `stats`
--

LOCK TABLES `stats` WRITE;
/*!40000 ALTER TABLE `stats` DISABLE KEYS */;
/*!40000 ALTER TABLE `stats` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tournament`
--

DROP TABLE IF EXISTS `tournament`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tournament` (
  `tournament_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `display_name` varchar(255) NOT NULL,
  `is_over` bit(1) NOT NULL,
  `name` varchar(255) NOT NULL,
  `user_id` bigint(20) DEFAULT NULL,
  `sport_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`tournament_id`),
  UNIQUE KEY `UKhswi99dqfqk68pblbp3xorngk` (`name`),
  KEY `FK9vgtiitd0tgfnr4e6ycv9wp92` (`user_id`),
  KEY `FKcd9y3gisxdycg7kp7pe6tfo1b` (`sport_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tournament`
--

LOCK TABLES `tournament` WRITE;
/*!40000 ALTER TABLE `tournament` DISABLE KEYS */;
/*!40000 ALTER TABLE `tournament` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user`
--

DROP TABLE IF EXISTS `user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user` (
  `user_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) DEFAULT NULL,
  `first_name` varchar(255) DEFAULT NULL,
  `last_name` varchar(255) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `user_name` varchar(255) NOT NULL,
  `external_id_provider` varchar(255) DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `external_id` bigint(20) DEFAULT NULL,
  `push_id` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `UK_lqjrcobrh9jc8wpcar64q1bfh` (`user_name`),
  UNIQUE KEY `external_id` (`external_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user`
--

LOCK TABLES `user` WRITE;
/*!40000 ALTER TABLE `user` DISABLE KEYS */;
/*!40000 ALTER TABLE `user` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_roles`
--

DROP TABLE IF EXISTS `user_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_roles` (
  `user_id` bigint(20) NOT NULL,
  `role_id` int(11) NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_roles`
--

LOCK TABLES `user_roles` WRITE;
/*!40000 ALTER TABLE `user_roles` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_roles` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2017-09-28 20:19:05
